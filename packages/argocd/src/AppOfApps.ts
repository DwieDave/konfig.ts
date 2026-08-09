import { type AnyRenderError, Compose, type Manifest as CoreManifest, unsafeCoerce } from "@konfig.ts/core"
import { Effect } from "effect"
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

export const entrypoint = Compose.makeResidualEntrypoint("AppOfApps.fromModules")

// any (not unknown) for bivariance at the inference site — same pattern as
// core's Compose.AnyHandle / Bundle.AnyHandle.
// oxlint-disable-next-line app/no-type-assertion
type AnyHandle = ApplicationHandle<any, any, any>

export type ResidualIn<T extends ReadonlyArray<AnyHandle>> = Compose.ResidualIn<T>

export interface FromModulesOptions<Ms extends ReadonlyArray<AnyHandle>> {
  readonly name?: string
  readonly target: AppOfAppsTarget
  readonly defaults: AppOfAppsDefaults
  readonly modules: Ms
}

// Order matters: list providers before consumers, or the consumer's Need
// surfaces at entrypoint as _konfig_unsatisfied. Duplicate provided names
// across modules fail here (_konfig_duplicate) rather than silently shadowing.
export const fromModules = <const Ms extends ReadonlyArray<AnyHandle>>(
  opts: FromModulesOptions<Ms> & Compose.NoDuplicateProvides<Ms, "AppOfApps.fromModules">
): Effect.Effect<
  AppOfAppsResult,
  AnyRenderError,
  ResidualIn<Ms> | CoreManifest.RenderServices
> => {
  const program = Effect.gen(function*() {
    const apps = yield* Effect.forEach(opts.modules, (mod) => mod)
    return make({
      name: opts.name,
      target: opts.target,
      defaults: opts.defaults,
      apps
    })
  })

  const wired = Compose.composeLayers(opts.modules)

  return unsafeCoerce<
    Effect.Effect<
      AppOfAppsResult,
      AnyRenderError,
      ResidualIn<Ms> | CoreManifest.RenderServices
    >
  >(
    Effect.provide(program, wired),
    "the runtime Effect is the same; only the static R channel is narrowed to ResidualIn<Ms> by the fold-as-type"
  )
}
