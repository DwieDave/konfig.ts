# @konfig.ts/argocd

Typed ArgoCD `Application` aggregation with compile-time dependency verification.

Builds on `@konfig.ts/core`'s `Manifest<A, R, P>` algebra. Each `Application.make(...)` call aggregates the R/P from its manifest list; `AppOfApps.make({...})` verifies at compile time that the union of all children's P covers every child's R.

## Surface

### `Application<R, P>` + `Application.make`

```ts
import { Application, AppOfApps, SyncWave } from "@konfig.ts/argocd"

const sops = Application.make({
  name: "sops-secrets-operator",
  namespace: "argocd",
  manifests: [helmRelease, namespace], // Manifest<...>[] — R/P aggregated automatically
  source: {
    repoURL: "ssh://git@github.com/example/infra.git",
    targetRevision: "main",
    path: "./infra/k8s/manifests/prod/sops-secrets-operator"
  },
  syncPolicy: { automated: { prune: false, selfHeal: false } },
  annotations: SyncWave(-1) // spread any annotation object here
})
```

`Application.make` infers `R` and `P` from the tuple of manifests — no manual annotation needed.

### `Module.fixedNs` / `Module.dynamicNs` — wrapper-builder factories

Building per-module wrappers (`defineKeycloak`, `defineApi`, etc.) by hand means writing a generic decl on every option interface and every define function, plus an `as Name` cast or `LiteralName<Name>` forward. `Module` packages that into a factory: the wrapper author writes no generics, and the literal `name` (and `namespace`, where applicable) still flows through to the resulting `ApplicationHandle<...>` for konfig's dependency tracking.

**Fixed namespace** — for modules whose namespace is part of their identity (e.g. `cert-manager` always installs into `cert-manager`):

```ts
import { Module, SyncWave } from "@konfig.ts/argocd"
import { Helm, Namespace } from "@konfig.ts/k8s"

export const defineSopsOperator = Module.fixedNs({
  namespace: "sops",
  annotations: SyncWave(-1),
  build: ({ namespace }, opts: { readonly resources?: ResourceLimits }) => [
    Namespace.make({ name: namespace }),
    Helm.release({ chart: "sops-secrets-operator", values: { resources: opts.resources } })
  ]
})
```

Call sites need no generic decl either:

```ts
const sops = defineSopsOperator({
  name: "sops-secrets-operator", // literal preserved through to ApplicationHandle<"sops-secrets-operator", ...>
  source: src("sops-secrets-operator")
})

const sopsStaging = defineSopsOperator({
  name: "sops-secrets-operator-staging", // different literal, different dep-graph slot
  source: src("sops-secrets-operator-staging")
})
```

Passing a bare `string` for `name` is rejected at compile time with a descriptive error from `Application.LiteralName`.

**Dynamic namespace** — for modules whose namespace is chosen per instance (e.g. an `api` module that ships into different env namespaces):

```ts
export const defineApi = Module.dynamicNs({
  annotations: SyncWave(1),
  build: ({ name, namespace }, opts: { readonly image: string; readonly host: string }) =>
    Effect.gen(function*() {
      // ... build manifests using opts.image, opts.host, etc.
      return [/* manifests */]
    })
})

// call site:
const api = defineApi({
  name: "api",
  namespace: "prod", // literal namespace — preserved
  source: src("api"),
  image: e.api,
  host: cluster.domain
})
```

The `build` callback can return either a synchronous `ReadonlyArray<unknown>` or an `Effect<readonly unknown[], AnyRenderError, R>`. Effect-based builds get their `R` propagated into the resulting `ApplicationHandle`'s requirements.

`Module` is non-opinionated about orchestration: it provides the literal-tracking and the build callback contract, and stays out of how envs / suffixes / source paths are derived. Users compose those policies in their own env files.

### `AppOfApps.make`

```ts
const prod = AppOfApps.make({
  target: {
    repoURL: "ssh://git@github.com/example/infra.git",
    branch: "main",
    rootPath: "./infra/k8s/manifests/prod"
  },
  defaults: { destination: { server: "https://kubernetes.default.svc" } },
  apps: [sops, certManager, web]
})
```

Return type: `AppOfAppsResult`.

The cross-app dependency check fires **at the call site itself**: `AppOfApps.make`'s opts param is intersected with an internal `AssertSatisfied<Apps>` constraint. When every child's R is covered by some sibling's P that constraint collapses to `unknown` and the opts pass through unchanged. When unsatisfied, the constraint demands a `_ERROR_unsatisfied_dependencies: RequiredDep<...>` property the caller can't reasonably supply — so the call errors with `"Property '_ERROR_unsatisfied_dependencies' is missing"` and the error message names the missing kind+name (e.g. `RequiredDep<"Application", "cert-manager">`). No user-side `satisfies` assertion needed.

### Sync helpers

```ts
import { Hook, SyncOptions, SyncWave } from "@konfig.ts/argocd"

SyncWave(-1) // → { "argocd.argoproj.io/sync-wave": "-1" }
Hook("PreSync") // → { "argocd.argoproj.io/hook": "PreSync" }
SyncOptions(["CreateNamespace=true"]) // → { "argocd.argoproj.io/sync-options": "..." }
```

Spread any of these into `Application.make`'s `annotations` field.

### CR emission

```ts
import { applicationCRFilename, serializeApplicationCR } from "@konfig.ts/argocd"

const yaml = serializeApplicationCR(app, target, defaults)
// → YAML string matching nixidy's Application-<name>.yaml shape exactly

const filename = applicationCRFilename(app)
// → "Application-<name>.yaml"
```

`emitApplicationCR(app, target, defaults)` wraps the same YAML in a `Manifest<string, Empty, Single<"Application", Name>>` for use in the M4 build pipeline.

## Types

| Export                                          | Description                                                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `Application<R, P>`                             | The typed Application node                                                                                 |
| `Application.make(opts)`                        | Aggregate R/P from manifests                                                                               |
| `Application.define(opts)`                      | Build an `ApplicationHandle` whose `.layer` provides `Provide<"App" \| "Application" \| "Namespace", ...>` |
| `Application.LiteralName<T>`                    | Brand that resolves to `T` if it's a string literal, or a branded error type if `T` widened to `string`    |
| `Module.fixedNs(config)`                        | Factory: typed wrapper with a baked-in namespace, zero generics at the call site                           |
| `Module.dynamicNs(config)`                      | Factory: typed wrapper with a per-instance namespace, zero generics at the call site                       |
| `AppOfApps.make(opts)`                          | Verify dep graph at the call site; return `AppOfAppsResult`                                                |
| `AppOfAppsResult`                               | Runtime shape passed to the renderer                                                                       |
| `MissingDeps<Apps>`                             | Type-level union of `RequiredDep` tags not covered by siblings (`never` when satisfied)                    |
| `RequiredDep<K, N>`                             | A single missing dep — kind+name pair surfaced in error messages                                           |
| `SyncWave(n)`                                   | Annotation helper                                                                                          |
| `Hook(phase)`                                   | Annotation helper                                                                                          |
| `SyncOptions(opts)`                             | Annotation helper                                                                                          |
| `serializeApplicationCR(app, target, defaults)` | Emit YAML string                                                                                           |
| `applicationCRFilename(app)`                    | `Application-<name>.yaml`                                                                                  |
| `emitApplicationCR(app, target, defaults)`      | Emit as `Manifest<string, Empty, Single<"Application", Name>>`                                             |

## Status

M3 of the `konfig-typesafe-k8s` workflow. The M4 CLI writer pipes `serializeApplicationCR` output to `apps/Application-<name>.yaml`. The M5 k8s primitives feed into `Application.make`'s `manifests` array.

## Requirements

konfig.ts builds on [Effect](https://effect.website/), which is still in
beta. Until Effect ships a stable 4.x, you must install the exact beta
konfig is developed against:

- **`effect@4.0.0-beta.70`** — required.
- **`@effect/platform-node@4.0.0-beta.70`** — required only for `render()`
  (the Node filesystem/subprocess entrypoint); manifest-only consumers can
  omit it.

The peer dependency is pinned to the exact version on purpose: Effect's beta
line makes breaking changes between builds, so a looser range would surface
as `ERESOLVE` install conflicts rather than a working install. This pin will
relax to a caret range once Effect reaches a stable 4.x.
