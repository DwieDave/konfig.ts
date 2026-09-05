# konfig.ts

[![npm](https://img.shields.io/npm/v/%40konfig.ts%2Fcore?label=npm)](https://www.npmjs.com/package/@konfig.ts/core)
![line coverage](.github/badges/coverage.svg)
![tests](.github/badges/tests.svg)
![effect](.github/badges/effect.svg)
[![license](https://img.shields.io/npm/l/%40konfig.ts%2Fcore?label=license)](LICENSE)
[![provenance](https://img.shields.io/badge/provenance-attested-1f6feb)](https://github.com/DwieDave/konfig.ts/attestations)

Typesafe Kubernetes + ArgoCD configuration in TypeScript, powered by
[Effect](https://effect.website/).

konfig.ts wires the manifest layer and the runtime config layer of an
app from a single TypeScript source. Branded references, env contracts,
and Effect `Layer` composition give you compile-time checks that catch
the failures you'd otherwise see at `argocd sync` time: a workload
referencing a Secret no one created, an env var consumed in code but
forgotten in the bundle, a chart pinned by name but not by digest.

## What it does

The dependency graph lives at the type level. Compose Applications with
`AppOfApps.fromModules(...)` and every module's `Dep.Need<...>` must be
met by another module's `Dep.Provide<...>`. A missing provider is a
TypeScript error at `AppOfApps.fromModules`, not a Sunday-morning
incident.

Env contracts are declared once. `Secret.define`, `Literal.define`, and
`Downward.define` produce atoms consumed by both `Environment.bind`
(manifest emission) and `Environment.runtime` (process-time decode).

YAML output is stable: YAML 1.1, deterministic field sort, ArgoCD-friendly
key ordering. The structural multi-doc diff ignores reordering and strips
Helm and redact noise, so diffs show real changes.

Three secret backends ship: sops, sealed-secrets, and external-secrets.
Each lowers a `Secret.define` to the matching CR and schema-validates
the binary's stdout. `requiresSource` is encoded in the backend's type,
so a missing source on a Sops backend is a compile error.

`Helm.release({ digest })` hashes the cached `.tgz` against `opts.digest`
on every pull and every cache hit. Flipping a byte fails the next render.

## Tour

A typed workload. The env var's `ref` is branded, so a Secret in the
wrong namespace won't compile:

```ts
import { Container, EnvVar, Port, Secret, Workload } from "@konfig.ts/k8s"

const apiCreds = Secret.make({ name: "api-creds", namespace: "prod", stringData: { url: "…" } })

Workload.web({
  name: "api",
  namespace: "prod",
  reloader: "stakater", // roll pods when the Secret rotates
  deployment: {
    containers: [
      Container.define({
        name: "api",
        image: "ghcr.io/example/api:1.0.0",
        ports: [Port.make({ name: "http", containerPort: 8080 })],
        env: [EnvVar.fromSecretForPod({ name: "DATABASE_URL", ref: apiCreds.ref, key: "url", podNamespace: "prod" })]
      })
    ]
  },
  service: { ports: [{ port: 80, targetPort: Port.ref("http") }] }
})
```

Dep-graph caught at compile time:

```ts
import { AppOfApps } from "@konfig.ts/argocd"

export default AppOfApps.fromModules({
  target,
  defaults,
  modules: [postgres, api] // ← forgot to add `imagePulls`
})
// api's build does `yield* Dep.Secret("ghcr-pull")`, which nothing provides:
//   _konfig_unsatisfied: Missing provider for Secret "ghcr-pull"…   ← compile error
```

The same env contract on both sides. Declare it once, in `@konfig.ts/env`:

```ts
import { Environment, Literal, Secret } from "@konfig.ts/env"

export const apiEnv = Environment.define({
  db: Secret.define({ name: "db-creds", namespace: "prod", env: { url: "DATABASE_URL" } }),
  port: Literal.define({ envName: "HTTP_PORT", value: 8080 })
})
```

Then bind and decode the same bundle, both via `@konfig.ts/k8s`:

```ts
import { Environment } from "@konfig.ts/k8s"

// infra module — emit the Deployment env block + the Secret CR:
Environment.bind({ env: apiEnv, namespace: "prod", secrets: { db: { backend: sopsBackend, source: sopsSource } } })

// app process — decode the same env vars at startup:
const config = await Effect.runPromise(Environment.runtime(apiEnv))
console.log(`api listening on :${config.port}`)
```

## Packages

| Package                                                      | Description                                                                                                                      |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| [`@konfig.ts/core`](./packages/core)                         | `Manifest<A>`, `Helm.release` (digest-verified), `Module.fixedNs`/`dynamicNs`, structural diff, stable YAML, `Dep.*`             |
| [`@konfig.ts/k8s`](./packages/k8s)                           | Kubernetes builders with branded refs; `Container.define`; `Workload.web`/`Workload.cron`; `SecretBackend<N, K, RequiresSource>` |
| [`@konfig.ts/env`](./packages/env)                           | `Secret.define`/`Literal.define`/`Downward.define`/`Environment.define`; `Environment.runtime` decoder                           |
| [`@konfig.ts/sops`](./packages/sops)                         | `Sops.source` + `Sops.backend` + `Sops.passthrough`; SopsSecret schema; fail-closed on unencrypted values                        |
| [`@konfig.ts/sealed-secrets`](./packages/sealed-secrets)     | `SealedSecret` CR backend; shells out to `kubeseal` with schema-validated stdout                                                 |
| [`@konfig.ts/external-secrets`](./packages/external-secrets) | `ExternalSecret` CR backend (no source required)                                                                                 |
| [`@konfig.ts/argocd`](./packages/argocd)                     | `Application.define`/`.target`; `AppOfApps.fromModules` (compile-time dep check); `Sync.wave`/`hook`/`options`                   |
| [`@konfig.ts/docker`](./packages/docker)                     | Workspace-graph-aware Dockerfile generator; Bun/Npm/Pnpm                                                                         |
| [`@konfig.ts/cli`](./packages/cli)                           | `konfig build`, `validate`, `diff`, `set`, `crd`, `helm`, `docker`, `graph`                                                      |

## What this is not

- A kustomize replacement. If you already have hand-written YAML and
  want to overlay it, this is the wrong tool; konfig owns the manifest
  source.
- A runtime mutator. It emits manifests; ArgoCD or kubectl applies
  them. There is no admission controller and no operator.
- A higher-level abstraction. No Crossplane, no OAM, no "Service" model
  that encapsulates Deployment/Service/Ingress beyond the explicit
  `Workload.web` helper.
- A `helm` replacement. It calls helm. Charts you depend on stay
  charts; the integration lifts each templated document as a
  `ParsedDoc` `Manifest`.

## Requirements

konfig.ts is built on [Effect](https://effect.website/), currently a release candidate.
Until Effect ships a stable 4.x, every `@konfig.ts/*` package requires a
caret range over the release-candidate line it is developed against:

- `effect@^4.0.0-rc.111`, required by every package.
- `@effect/platform-node@^4.0.0-rc.111`, a regular dependency of
  `@konfig.ts/core` (its `render()` entrypoint needs the Node filesystem and
  subprocess services), so it is installed automatically with core.

The range floats within the rc line on purpose: Effect's pre-release line makes
breaking changes between builds, so a looser range would end in `ERESOLVE`
install conflicts rather than a working install. It widens to `^4.x` once
Effect reaches a stable 4.x.

## Quickstart

```bash
bun install
bun run check
bun run test
bun run konfig --help
```

See [`examples/full-stack`](./examples/full-stack) for the complete
walkthrough: a monorepo with env contracts, secret backends, and ArgoCD
wiring. The worked-failure files under
[`examples/full-stack/infra/envs/`](./examples/full-stack/infra/envs)
show each compile error the type system catches.

For architecture and per-package internals see
[`.docs/architecture.md`](./.docs/architecture.md).
