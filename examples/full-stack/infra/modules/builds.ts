import { Application } from "@konfig.ts/argocd"
import { Dep } from "@konfig.ts/core"

export interface BuildOpts {
  readonly registry: string
  readonly tag: string
}

/**
 * Build modules for the api / worker container images.
 *
 * Exist purely as dep-graph anchors — they emit no Kubernetes manifests
 * (the build pipeline that produces the image is out of band, e.g. a
 * CI job triggered by `Application.build` metadata). What they do emit
 * is `Dep.Provide<"Image", "api" | "worker">` via the wrapper-level
 * `provides`, so the consuming workload's `yield* Dep.Image("api")`
 * resolves at composition time.
 *
 * Forgetting to add one of these to `fromModules({ modules })` surfaces
 * as `_konfig_unsatisfied: "Missing provider for Image \"api\"..."` at
 * `AppOfApps.entrypoint` — the same shape as a missing Secret provider.
 *
 * Each build module's `provides` depends on per-instance options
 * (registry, tag), so this uses the per-call `provides` overload of
 * `Application.define` directly rather than `Module.fixedNs`'s
 * static `provides` slot. A thin `Module.fixedNs`-shaped wrapper would
 * fix the registry/tag at wrapper-construction time, which is the wrong
 * tradeoff for build modules that may be re-tagged per env.
 */
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
