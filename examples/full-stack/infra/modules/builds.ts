import { Application } from "@konfig.ts/argocd"
import { Dep } from "@konfig.ts/core"

export interface BuildOpts {
  readonly registry: string
  readonly tag: string
}

// Dep-graph anchors only — emit no manifests, just provide `Dep.Image` for the consuming workload.
// Uses `Application.define`'s per-call `provides` (not `Module.fixedNs`) since registry/tag vary per instance.
export const defineApiBuild = <const Name extends string>(
  opts: {
    readonly name: Application.LiteralName<Name>
    readonly source: Application.ArgoSource
  } & BuildOpts
) =>
  Application.define({
    name: opts.name,
    namespace: "app",
    source: opts.source,
    provides: Dep.provideImage({ app: "api", registry: opts.registry, tag: opts.tag }),
    build: () => []
  })

export const defineWorkerBuild = <const Name extends string>(
  opts: {
    readonly name: Application.LiteralName<Name>
    readonly source: Application.ArgoSource
  } & BuildOpts
) =>
  Application.define({
    name: opts.name,
    namespace: "app",
    source: opts.source,
    provides: Dep.provideImage({ app: "worker", registry: opts.registry, tag: opts.tag }),
    build: () => []
  })
