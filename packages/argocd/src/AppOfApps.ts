import { type AnyRenderError, Compose, type Manifest as CoreManifest, unsafeCoerce } from "@konfig.ts/core"
import { Effect, Layer } from "effect"
import type { Application, ApplicationHandle } from "./Application"

export interface AppOfAppsTarget {
  readonly repoURL: string
  readonly branch: string
  readonly rootPath: string
  readonly controllerNamespace?: string
}

export interface AppOfAppsDefaults {
  readonly destination?: {
    readonly server?: string
  }
  readonly project?: string
  readonly syncPolicy?: import("./Application").SyncPolicy
}

export interface AppOfAppsResult {
  readonly name: string
  readonly target: AppOfAppsTarget
  readonly defaults: AppOfAppsDefaults
  readonly apps: ReadonlyArray<Application>
}

export interface AppOfAppsMakeOptions {
  readonly name?: string
  readonly target: AppOfAppsTarget
  readonly defaults: AppOfAppsDefaults
  readonly apps: ReadonlyArray<Application>
}

export const make = (opts: AppOfAppsMakeOptions): AppOfAppsResult => ({
  name: opts.name ?? "apps",
  target: opts.target,
  defaults: opts.defaults,
  apps: opts.apps
})

/**
 * @deprecated `AppOfApps.fromModules` now performs the residual-dependency
 * check itself and returns a directly renderable Effect — wrapping it in
 * `AppOfApps.entrypoint` is no longer needed. Export the `fromModules` result
 * directly. This wrapper will be removed in a future release.
 */
export const entrypoint = Compose.makeResidualEntrypoint("AppOfApps.fromModules")

// any (not unknown) for bivariance at the inference site — same pattern as
// core's Compose.AnyHandle / Bundle.AnyHandle.
// oxlint-disable-next-line app/no-type-assertion
type AnyHandle = ApplicationHandle<any, any, any>

export type ResidualIn<T extends ReadonlyArray<AnyHandle>> = Compose.ResidualIn<T>

export interface FromModulesOptions<Ms extends ReadonlyArray<AnyHandle>, Extra = never> {
  readonly name?: string
  readonly target: AppOfAppsTarget
  readonly defaults: AppOfAppsDefaults
  readonly modules: Ms
  readonly provides?: Layer.Layer<Extra>
}

// Order matters: list providers before consumers, or the consumer's Need
// fails right here as _konfig_unsatisfied. Duplicate provided names across
// modules fail as _konfig_duplicate rather than silently shadowing. A
// group-level `provides` layer can satisfy needs no module provides. The
// result is sealed: R is exactly RenderServices, no entrypoint wrapper needed.
export const fromModules = <const Ms extends ReadonlyArray<AnyHandle>, Extra = never>(
  opts:
    & FromModulesOptions<Ms, Extra>
    & Compose.NoDuplicateProvides<Ms, "AppOfApps.fromModules">
    & Compose.ResidualCheck<Exclude<ResidualIn<Ms>, Extra>, "AppOfApps.fromModules">
): Effect.Effect<AppOfAppsResult, AnyRenderError, CoreManifest.RenderServices> => {
  const program = Effect.gen(function*() {
    const apps = yield* Effect.forEach(opts.modules, (mod) => mod)
    return make({
      name: opts.name,
      target: opts.target,
      defaults: opts.defaults,
      apps
    })
  })

  const composed = Compose.composeLayers(opts.modules)
  const wired = opts.provides !== undefined
    ? Layer.provideMerge(
      composed,
      unsafeCoerce<Layer.Layer<never>>(
        opts.provides,
        "group-level provides layer participates only via the type-level residual check; the fold collapses to AnyLayer"
      )
    )
    : composed

  return unsafeCoerce<
    Effect.Effect<AppOfAppsResult, AnyRenderError, CoreManifest.RenderServices>
  >(
    Effect.provide(program, wired),
    "the ResidualCheck phantom intersection proved the residual empty, so R narrows to RenderServices"
  )
}
