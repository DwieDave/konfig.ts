import { type AnyRenderError, Compose, type Manifest as CoreManifest } from "@konfig.ts/core"
import { type Effect, type Layer, Schema } from "effect"
import { type Application, Application as ApplicationSchema, type ApplicationHandle, SyncPolicy } from "./Application"

export const AppOfAppsTarget = Schema.Struct({
  repoURL: Schema.String,
  branch: Schema.String,
  rootPath: Schema.String,
  controllerNamespace: Schema.optionalKey(Schema.String)
})

export type AppOfAppsTarget = typeof AppOfAppsTarget.Type

export const AppOfAppsDefaults = Schema.Struct({
  destination: Schema.optionalKey(Schema.Struct({ server: Schema.optionalKey(Schema.String) })),
  project: Schema.optionalKey(Schema.String),
  syncPolicy: Schema.optionalKey(SyncPolicy)
})

export type AppOfAppsDefaults = typeof AppOfAppsDefaults.Type

export const AppOfAppsResult = Schema.Struct({
  name: Schema.String,
  target: AppOfAppsTarget,
  defaults: AppOfAppsDefaults,
  apps: Schema.Array(ApplicationSchema)
})

export type AppOfAppsResult = typeof AppOfAppsResult.Type

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

// any (not unknown) for bivariance at the inference site — same pattern as
// core's Compose.AnyHandle / Bundle.AnyHandle.
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
// result is sealed: R is exactly RenderServices.
export const fromModules = <const Ms extends ReadonlyArray<AnyHandle>, Extra = never>(
  opts:
    & FromModulesOptions<Ms, Extra>
    & Compose.NoDuplicateProvides<Ms, "AppOfApps.fromModules">
    & Compose.ResidualCheck<Exclude<ResidualIn<Ms>, Extra>, "AppOfApps.fromModules">
): Effect.Effect<AppOfAppsResult, AnyRenderError, CoreManifest.RenderServices> =>
  Compose.sealModules({
    modules: opts.modules,
    provides: opts.provides,
    build: (apps) => make({ name: opts.name, target: opts.target, defaults: opts.defaults, apps })
  })
