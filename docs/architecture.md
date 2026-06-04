# konfig.ts architecture

This document is the load-bearing answer to "where does the
type-safety live, and how is it composed?" Every package README links
back here.

## The 30-second model

```
  TS source                                 emitted YAML
  ─────────                                 ────────────

  Application.define({ name, build })      Application-<name>.yaml
            │ ▲                                    ▲
            │ │ Layer<Out, _, In>                  │
            ▼ │                                    │
  Effect.gen(... yield* api ...)            <Kind>-<name>.yaml
            │                               <Kind>-<name>.yaml
            │ Effect program                       ▲
            ▼                                      │
  AppOfApps.entrypoint(program)            CLI build / writeFiles
            ▲                                      │
            │ type In must be `never`               │
            └──────────────────────────────────────┘
```

konfig is two layers of composition:

1. **Inside an Application** — an `Effect` builds the manifest
   `ReadonlyArray<unknown>` for that one app, yielding `Dep.*` services
   to read branded refs and SecretRef-checked env vars.
2. **Across Applications** — each `Application.define(...)` returns an
   `ApplicationHandle<Name, Out, In>` that is both an Effect
   `Context.Service` tag (for `yield* api` to obtain the `Application`)
   AND carries a `Layer<Out, AnyRenderError, In>`. Composing handles
   with `Layer.provideMerge` shrinks `In`; `AppOfApps.entrypoint`
   requires `In = never`.

The second layer is where the dep-graph check fires.

## The `Manifest<A>` carrier

```ts
interface Manifest<A> {
  readonly render: (
    ctx: RenderContext,
  ) => Effect.Effect<A, AnyRenderError, RenderServices>;
}
```

A `Manifest<A>` is **only** a recipe for producing a value `A` given a
`RenderContext`. It does *not* track per-kind R/P sets in its type —
that work happens via Effect `Layer`s one level up. Constructors
(`Manifest.make`, `Manifest.combine`, `Manifest.concat`,
`Manifest.embedYaml`) compose them; the renderer is plain Effect.

The `RenderServices` slot is `FileSystem | Path | ChildProcessSpawner |
Scope` — the platform deps for reading files, spawning sops/helm, and
managing scoped temp directories.

## Dep tracking — `Dep.*` and `Layer`

```ts
import { Dep } from "@konfig.ts/core";
```

| Service tag | What its Layer provides |
|---|---|
| `Dep.Secret(name)` | `SecretRef<Name>` |
| `Dep.ConfigMap(name)` | `ConfigMapRef<Name>` |
| `Dep.Namespace(name)` | `Name` literal |
| `Dep.ServiceAccount(name)` | `ServiceAccountRef<Name>` |
| `Dep.Pvc(name)` | `PvcRef<Name>` |
| `Dep.Application(name)` | `Name` literal |
| `Dep.SecretValues(name)` | `{ readonly [k in K]: Redacted<string> }` |
| `Dep.App(name)` | `Application` record |

A consuming module:

```ts
const url = yield* SecretRef.url; // expects a Dep.Secret("api-creds") provider
```

A providing module:

```ts
Layer.succeed(Dep.Secret("api-creds"))(SecretRef.of("api-creds"))
```

Tags with `provideX(name)` helpers live in
`packages/core/src/deps.ts`.

## `Application.define` — the load-bearing function

```ts
export const define = <Name extends string, Ns extends string, R, Extra>(
  opts: ApplicationDefineOptions<Name, Ns, R, Extra>,
): ApplicationHandle<
  Name,
  | Dep.Provide<"App", Name>
  | Dep.Provide<"Application", Name>
  | Dep.Provide<"Namespace", Ns>
  | Extra,
  Exclude<R, Dep.Need<"Application", Name> | Dep.Need<"Namespace", Ns> | Extra>
>;
```

The return type is the algebra:

- **`Out` channel** — every `Provide<Kind, Name>` this Application emits.
- **`In` channel** — every `Need<Kind, Name>` from the `build` Effect's
  `R` slot that this Application doesn't satisfy itself.

`Application.define` writes the `Out` brands and subtracts its
self-provided pairs (App, Application, Namespace) from the `In`.

Composing handles:

```ts
const program = Effect.gen(function* () {
  const a = yield* api;            // a: Application
  const b = yield* worker;
  return AppOfApps.make({ ..., apps: [a, b] });
}).pipe(Effect.provide(Layer.mergeAll(api.layer, worker.layer, imagePulls.layer)));

export default AppOfApps.entrypoint(program);
//                              ^^^ requires program's R to be `never`
```

If `imagePulls.layer` is missing, `program` has a leftover
`Need<"Secret", "ghcr-pull">` in its `R` channel, and `entrypoint`
rejects it with a TypeScript error. See
[`examples/full-stack/infra/envs/broken.ts`](../examples/full-stack/infra/envs/broken.ts).

## `Environment` — env contracts as one source of truth

`@konfig.ts/env` builds a tree of yieldable Configs:

- `defineSecret({ name, namespace, env: { url: "DATABASE_URL", ... } })`
  produces a `SecretEntry` whose `env` record maps logical key → env
  var name.
- `defineLiteral({ envName, value, schema? })` is a constant value with
  an optional `Config.string`-based runtime schema.
- `defineDownward({ envName, fieldPath })` reads a K8s downward-API
  field at pod-spec emission time.
- `defineEnvironment({ ... })` composes them into a bundle.

The bundle is both a `Config<EnvironmentShape<M>>` (consumed at
runtime) AND carries the metadata `Environment.bind` needs to emit the
Deployment's env block + the chosen secret backend's CRs:

```ts
// Manifest side:
Environment.bind({
  env: apiEnv,
  secrets: {
    db: { backend: Sops.backend(...), source: Sops.source(...) },
  },
});

// Runtime side:
const config = yield* Environment.runtime(apiEnv);
```

Compile-time enforcement (per the type-level check in
`packages/env/src/environment.ts`):
- Two members claiming the same `envName` → branded error type.
- `Environment.bind` requires every secret member to have a binding;
  missing one is a TS error.
- A `requiresSource: true` backend (Sops, SealedSecrets,
  NativeSecret) makes the `source` field required at the member
  options level.

## `Helm.release` — chart pull + digest verify

```ts
Helm.release({
  repo: "https://charts.bitnami.com/bitnami",
  chart: "postgresql",
  version: "16.0.0",
  digest: "sha256:483dc15...",                   // verified after pull AND on cache hit
  namespace: "app",
  values: { ... },
});
```

Lifts every YAML document `helm template` emits as a `RawYaml`
`Manifest` under the parent Application. SHA-256 of the cached `.tgz`
is compared to `opts.digest` on every load; mismatch fails with
`HelmDigestMismatch` and deletes the cache file.

## CLI

The CLI is built on `effect/unstable/cli`. The unstable surface is
isolated behind `packages/cli/src/_unstable.ts`; see
[`compat.md`](../compat.md) for the full list of unstable modules and
the policy for bumping.

Commands:

| Command | Purpose |
|---|---|
| `konfig build <env>` | Render an env's `AppOfApps` to YAML files. Atomic write via staging dir. |
| `konfig validate <env>` | Render + structural envelope check. `--strict` adds kubeconform. |
| `konfig diff <env>` | Structural diff vs. a baseline. Multi-doc aware. |
| `konfig crd extract/verify` | CRD codegen from Helm charts (input-validated argv, never `/bin/sh -c`). |
| `konfig helm fetch` | Pre-pull every chart's tarball. |
| `konfig docker diff/write <appPath>` | Workspace-graph-aware Dockerfile generation. |
| `konfig set <env> <key=val>` | Apply per-env image overrides. |

Flags shared across `build`/`validate`/`diff`:

- `--cluster <name>` — render path becomes `<env>/<cluster>/...`; `ctx.cluster` is set.
- `--k8s-version <ver>` — `ctx.k8sVersion` set, available to manifest factories.
- `--flag k=v` — `ctx.flags.get(k)` returns `v`.

## Why Effect?

Three loadbearing reasons.

1. **Layer-based dep injection at the type level.** Layers preserve a
   `Provide<...>` / `Need<...>` algebra in their type parameters,
   which is exactly what the konfig dep-graph needs. Without
   `Layer<Out, _, In>`, we'd reinvent typed DI with worse
   ergonomics. Effect already has it.

2. **Tagged errors.** Render-time failures (HelmDigestMismatch,
   BoundaryDecodeError, CrdExtractError, ...) thread through the
   Effect channel as part of the `R` slot. Callers handle each one or
   propagate it; no try/catch noise.

3. **`Config<T>`, `Schema`, and `Redacted<T>`.** Three primitives we'd
   otherwise build by hand. `Config<T>` is the runtime-decoder layer;
   `Schema` is the boundary decoder for sops/kubeseal stdout;
   `Redacted<T>` keeps secret values out of error messages.

The trade-off: contributors need a working mental model of Effect's
Context, Layer, and Yieldable types. We make that approachable by
keeping the public surface small (the `define*` family) and exposing
the underlying machinery through one Application.test.ts unit test
that locks the `attachLayerToTag` cast in place.

## Layout

```
packages/
├── core/             Manifest, Helm, Dep.*, KonfigConfig, diff, YAML
├── env/              defineSecret/Literal/Downward/Environment + runtime
├── k8s/              Workload/Service/Ingress + branded refs + SecretBackend
├── sops/             Sops.source + Sops.backend (Schema-validated stdout)
├── sealed-secrets/   SealedSecrets.backend (Schema-validated kubeseal stdout)
├── external-secrets/ ExternalSecrets.backend
├── argocd/           Application.define, AppOfApps.entrypoint, Module.fixedNs/dynamicNs
├── docker/           Workspace graph + Dockerfile IR for Bun/Npm/Pnpm/Yarn
├── cli/              `konfig` binary
└── oxc/              house-style lint rules (oxlint plugins)

examples/full-stack/
├── apps/                    Bun/Node runtime apps consuming Environment.runtime
├── infra/                   Module + env definitions
└── shared/env-contracts/    The bundle source of truth
```

See per-package READMEs for the surface APIs and gotchas.
