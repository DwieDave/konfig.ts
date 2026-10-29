# @konfig.ts/argocd

Typed ArgoCD `Application` aggregation with a compile-time dependency graph.
Each module declares what it provides and what it needs; compose them into an
app-of-apps and a missing provider becomes a TypeScript error at `fromModules` —
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

export default AppOfApps.fromModules({
  target: { repoURL, branch: "main", rootPath: "./manifests/prod" },
  defaults: { destination: { server: "https://kubernetes.default.svc" } },
  modules: [postgres, api] // providers first; the order documents intent
})
```

If `api`'s build does `yield* Dep.Secret("ghcr-pull")` and no module in the list
provides it, `fromModules` refuses to compile:
`_konfig_unsatisfied: Missing provider for Secret "ghcr-pull"…`.

## Surface

| Export                                                                   | Purpose                                                                                                                                                    |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Application.define`                                                     | build an `ApplicationHandle<Name, Out, In>` — an Effect Context tag that also carries a `Layer<Out, _, In>`                                                |
| `Application.make`                                                       | plain `Application` value constructor (no dep graph)                                                                                                       |
| `Application.target`                                                     | adapter passed to `Module.fixedNs` / `Module.dynamicNs`                                                                                                    |
| `Application.LiteralName<T>`                                             | rejects a `string`-widened `name` at the call site                                                                                                         |
| `AppOfApps.fromModules`                                                  | compose module handles into a sealed, renderable app-of-apps; the compile-time dep check fires here (group-level `provides?: Layer` fills remaining needs) |
| `AppOfApps.entrypoint`                                                   | deprecated no-op wrapper, kept for one release; export `fromModules` directly instead                                                                      |
| `AppOfApps.make`                                                         | plain `AppOfAppsResult` constructor from already-built `Application`s                                                                                      |
| `Sync.wave` / `Sync.hook` / `Sync.options`                               | ArgoCD annotation helpers — spread into `annotations`                                                                                                      |
| `serializeApplicationCR` / `applicationCRFilename` / `emitApplicationCR` | emit an Application CR as a YAML string, a filename, or a `Manifest<string>`                                                                               |

## Internals

`Application.define`'s return type is the algebra: the `Out` channel lists every
`Dep.Provide` the Application emits, the `In` channel every unmet `Dep.Need`.
Composing modules shrinks `In`; `fromModules` requires it to reduce to the render services.
See [`.docs/architecture.md`](../../.docs/architecture.md).

## Requirements

konfig.ts is built on [Effect](https://effect.website/) 4. Any 4.x build from 4.0.0 on
is supported:

- **`effect@^4.0.0`** — peer dependency of every package.
- **`@effect/platform-node@^4.1.0`** — a regular dependency of `@konfig.ts/core`,
  whose `render()` entrypoint needs the Node filesystem/subprocess services.
  It is installed automatically with core.
