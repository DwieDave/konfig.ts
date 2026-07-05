# @konfig.ts/argocd

Typed ArgoCD `Application` aggregation with a compile-time dependency graph.
Each module declares what it provides and what it needs; compose them into an
app-of-apps and a missing provider becomes a TypeScript error at `entrypoint` —
not a sync failure at 2am.

## Install

```bash
bun add @konfig.ts/argocd
```

## Usage

Wrap each Application as a reusable module (`Module.fixedNs` / `Module.dynamicNs`
from `@konfig.ts/core`, adapted with `Application.target`), then compose an
environment. The env file's default export is what `konfig build` renders:

```ts
import { Application, AppOfApps, Sync } from "@konfig.ts/argocd"
import { Helm, Module } from "@konfig.ts/core"
import { Namespace } from "@konfig.ts/k8s"

export const definePostgres = Module.fixedNs({
  target: Application.target,
  namespace: "data",
  annotations: Sync.wave(-1), // ArgoCD sync-wave; spread into annotations
  build: ({ namespace }, opts: { storageGi: number }) => [
    Namespace.make({ name: namespace }),
    Helm.release({/* … */})
  ]
})

// src(name) → { repoURL, targetRevision, path };  defineApi is another module
const postgres = definePostgres({ name: "postgres", source: src("postgres"), storageGi: 20 })
const api = defineApi({ name: "api", source: src("api"), replicas: 2 })

export default AppOfApps.entrypoint(
  AppOfApps.fromModules({
    target: { repoURL, branch: "main", rootPath: "./manifests/prod" },
    defaults: { destination: { server: "https://kubernetes.default.svc" } },
    modules: [postgres, api] // providers first; the order documents intent
  })
)
```

If `api`'s build does `yield* Dep.Secret("ghcr-pull")` and no module in the list
provides it, `entrypoint` refuses to compile:
`_konfig_unsatisfied: Missing provider for Secret "ghcr-pull"…`.

## Surface

| Export                                                                   | Purpose                                                                                                     |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `Application.define`                                                     | build an `ApplicationHandle<Name, Out, In>` — an Effect Context tag that also carries a `Layer<Out, _, In>` |
| `Application.make`                                                       | plain `Application` value constructor (no dep graph)                                                        |
| `Application.target`                                                     | adapter passed to `Module.fixedNs` / `Module.dynamicNs`                                                     |
| `Application.LiteralName<T>`                                             | rejects a `string`-widened `name` at the call site                                                          |
| `AppOfApps.fromModules`                                                  | compose module handles into a renderable app-of-apps (unmet needs surface in its `R`)                       |
| `AppOfApps.entrypoint`                                                   | wrap a program as the env's default export; the compile-time dep check fires here                           |
| `AppOfApps.make`                                                         | plain `AppOfAppsResult` constructor from already-built `Application`s                                       |
| `Sync.wave` / `Sync.hook` / `Sync.options`                               | ArgoCD annotation helpers — spread into `annotations`                                                       |
| `serializeApplicationCR` / `applicationCRFilename` / `emitApplicationCR` | emit an Application CR as a YAML string, a filename, or a `Manifest<string>`                                |

## Internals

`Application.define`'s return type is the algebra: the `Out` channel lists every
`Dep.Provide` the Application emits, the `In` channel every unmet `Dep.Need`.
Composing modules shrinks `In`; `entrypoint` requires it to reduce to `never`.
See [`.docs/architecture.md`](../../.docs/architecture.md).

## Requirements

konfig.ts is built on [Effect](https://effect.website/), currently in beta.
Until Effect ships a stable 4.x, install the exact beta konfig.ts is built
against:

- **`effect@4.0.0-beta.70`** — required by every package.
- **`@effect/platform-node@4.0.0-beta.70`** — required only when you call
  `render()` (the Node filesystem/subprocess entrypoint); manifest-only
  consumers can omit it (it is declared as an optional peer).

The pin is exact on purpose: Effect's beta line makes breaking changes between
builds, so a looser range surfaces as `ERESOLVE` install conflicts. It relaxes
to a caret range once Effect reaches a stable 4.x.
