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

/**
 * Phantom check that rejects programs whose `R` channel still carries
 * unmet dep-graph Needs. Bound to the "AppOfApps.fromModules" API label
 * so the `_konfig_unsatisfied` hint guides the user to the right call.
 */
export const entrypoint = Compose.makeResidualEntrypoint("AppOfApps.fromModules")

// `any` in the AnyHandle upper bound: Effect's Layer is contravariant in
// its first parameter and `ApplicationHandle` is invariant at the inference
// site. `unknown` rejects concrete subtypes; `any` is bivariant — the
// canonical "any handle" upper bound.
// oxlint-disable-next-line app/no-type-assertion
type AnyHandle = ApplicationHandle<any, any, any>

/**
 * After folding `Layer.provideMerge` over `Ms` in tuple order, the
 * leftover `RIn` channel. Public type alias preserved so downstream code
 * importing `AppOfApps.ResidualIn` keeps working.
 */
export type ResidualIn<T extends ReadonlyArray<AnyHandle>> = Compose.ResidualIn<T>

export interface FromModulesOptions<Ms extends ReadonlyArray<AnyHandle>> {
  readonly name?: string
  readonly target: AppOfAppsTarget
  readonly defaults: AppOfAppsDefaults
  readonly modules: Ms
}

/**
 * One-list composition for an app-of-apps. Yields each module's
 * `Application` in tuple order, then wires the merged provider layer
 * with `Compose.composeLayers`. The returned Effect's R channel is the
 * residual unmet Needs after that fold (`Compose.ResidualIn<Ms>`),
 * which `entrypoint` rejects unless empty.
 *
 * **Order matters.** List providers before their consumers. A consumer
 * placed before its provider leaves a `Dep.Need<...>` in the residual,
 * which surfaces at `entrypoint` as a `_konfig_unsatisfied` hint.
 */
export const fromModules = <const Ms extends ReadonlyArray<AnyHandle>>(
  opts: FromModulesOptions<Ms>
): Effect.Effect<
  AppOfAppsResult,
  AnyRenderError,
  ResidualIn<Ms> | CoreManifest.RenderServices
> => {
  const program = Effect.gen(function*() {
    const apps: Application[] = []
    for (const mod of opts.modules) {
      const app = yield* mod
      apps.push(app)
    }
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
