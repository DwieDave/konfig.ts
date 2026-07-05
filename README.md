# konfig.ts

Typesafe Kubernetes + ArgoCD configuration in TypeScript, powered by
[Effect](https://effect.website/).

konfig.ts wires the manifest layer and the runtime config layer of an
app from a single TypeScript source. Branded references, env contracts,
and Effect `Layer` composition give you compile-time checks that catch
the failures you'd otherwise see at `argocd sync` time: a workload
referencing a Secret no one created, an env var consumed in code but
forgotten in the bundle, a chart pinned by name but not by digest.

## What you get

- **Dep-graph at the type level.** `AppOfApps.entrypoint(program)`
  requires every Application's `Need<...>` to be discharged by another
  Application's `Provide<...>`. Missing a layer is a TypeScript error,
  not a Sunday-morning incident.
- **Env contracts as a single source of truth.** `defineSecret`,
  `defineLiteral`, and `defineDownward` produce atoms consumed by both
  `Environment.bind` (manifest emission) and `Environment.runtime`
  (process-time decode).
- **Real YAML diffs, not patch noise.** Stable key ordering (YAML 1.1,
  deterministic field sort, ArgoCD-friendly), structural multi-doc diff
  that ignores reordering, and Helm/redact stripping out of the box.
- **First-class secret backends.** sops, sealed-secrets, and
  external-secrets each lower a `defineSecret` to the right CR with
  full schema validation on the binary's stdout. `requiresSource` is
  encoded in the backend's type, so a missing source on a Sops backend
  is a compile error.
- **Helm with digest verification.** `Helm.release({ digest })` hashes
  the cached `.tgz` against `opts.digest` on every pull AND every cache
  hit — flipping a byte fails the next render.

## A 60-second tour

A typed Workload:

```ts
import { secretEnv, Workload } from "@konfig.ts/k8s";

const apiSecret = Secret.make({ name: "api-creds", namespace: "prod", stringData: {...} });

Workload.web({
  name: "api",
  namespace: "prod",
  reloader: "stakater",                         // pod restart on Secret rotation
  deployment: {
    containers: [{
      name: "api",
      image: "ghcr.io/example/api:1.0.0",
      env: [secretEnv("DATABASE_URL", { ref: apiSecret.ref, key: "url" })],
    }],
  },
  service: { ports: [{ port: 80 }] },
});
```

Dep-graph caught at compile time:

```ts
import { AppOfApps } from "@konfig.ts/argocd";

const api = defineApi({ ... });
const program = Effect.gen(function* () {
  const a = yield* api;
  return AppOfApps.make({ ..., apps: [a] });
}).pipe(Effect.provide(api.layer));   // ← forgot to merge imagePulls.layer

// @ts-expect-error Need<"Secret", "ghcr-pull"> is not assignable to never
export default AppOfApps.entrypoint(program);
```

The same env contract on both sides:

```ts
import { defineEnvironment, defineLiteral, defineSecret } from "@konfig.ts/env"
import { Environment } from "@konfig.ts/k8s"

export const apiEnv = defineEnvironment({
  db: defineSecret({ name: "db-creds", namespace: "prod", env: { url: "DATABASE_URL" } }),
  port: defineLiteral({ envName: "HTTP_PORT", value: 8080 })
})

// In a konfig module — emit the Deployment env block + the Secret CR:
Environment.bind({ env: apiEnv, secrets: { db: { backend: sopsBackend, source: sopsSource } } })

// In the app process — decode the same env vars at startup:
const config = await Effect.runPromise(Environment.runtime(apiEnv))
console.log(`api listening on :${config.port}`)
```

## Packages

| Package                                                      | Description                                                                                                           |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| [`@konfig.ts/core`](./packages/core)                         | `Manifest<A>`, `Helm.release` with digest verification, structural diff, stable YAML, `Dep.*` kinds                   |
| [`@konfig.ts/k8s`](./packages/k8s)                           | Kubernetes resource builders with branded refs; `Workload.web`/`Workload.cron`; `SecretBackend<N, K, RequiresSource>` |
| [`@konfig.ts/env`](./packages/env)                           | `defineSecret`/`defineLiteral`/`defineDownward`/`defineEnvironment`; `Environment.runtime` decoder                    |
| [`@konfig.ts/sops`](./packages/sops)                         | `Sops.source` + `Sops.backend`; SopsSecret schema; recipient validation (no `,` smuggling)                            |
| [`@konfig.ts/sealed-secrets`](./packages/sealed-secrets)     | SealedSecret CR backend; shells out to `kubeseal` with schema-validated stdout                                        |
| [`@konfig.ts/external-secrets`](./packages/external-secrets) | ExternalSecret CR backend (no source required)                                                                        |
| [`@konfig.ts/argocd`](./packages/argocd)                     | `Application.define` (Effect Context.Tag + Layer); `AppOfApps.entrypoint`; `Module.fixedNs`/`Module.dynamicNs`        |
| [`@konfig.ts/docker`](./packages/docker)                     | Workspace-graph-aware Dockerfile generator; Bun/Npm/Pnpm/Yarn                                                         |
| [`@konfig.ts/cli`](./packages/cli)                           | `konfig build`, `validate`, `diff`, `crd`, `helm`, `docker`, `set`                                                    |

## What this is _not_

- **Not a kustomize replacement** for cases where you already have
  hand-written YAML and want to overlay it. konfig owns the manifest
  source.
- **Not a runtime mutator.** It emits manifests; ArgoCD or kubectl
  applies them. There's no admission controller, no operator.
- **Not a higher-level abstraction.** No Crossplane, no OAM, no
  "Service" model that encapsulates Deployment/Service/Ingress beyond
  the explicit `Workload.web` helper.
- **Not a `helm` replacement.** It calls helm. Helm charts you depend
  on stay charts; the integration just lifts each templated document
  as a `RawYaml` `Manifest`.

## Requirements

konfig.ts is built on [Effect](https://effect.website/), which is still in
beta. Until Effect ships a stable 4.x, every `@konfig.ts/*` package requires
the exact beta it is developed against:

- **`effect@4.0.0-beta.70`** — required by every package.
- **`@effect/platform-node@4.0.0-beta.70`** — required only for `render()`
  (the Node filesystem/subprocess entrypoint in `@konfig.ts/core`);
  manifest-only consumers can omit it (it is declared as an optional peer).

The peer dependency is pinned to the exact version on purpose: Effect's beta
line makes breaking changes between builds, so a looser range would surface
as `ERESOLVE` install conflicts rather than a working install. This pin will
relax to a caret range once Effect reaches a stable 4.x.

## Quickstart

```bash
bun install
bun run check
bun run test
bun run konfig --help
```

See [`examples/full-stack`](./examples/full-stack) for the complete
walkthrough — a 3-app monorepo with env contracts, secret backends,
and ArgoCD wiring — plus the worked-failure files under
[`examples/full-stack/infra/envs/`](./examples/full-stack/infra/envs)
that demonstrate every `@ts-expect-error` the type system catches.

For architecture and per-package internals see
[`docs/architecture.md`](./docs/architecture.md).
