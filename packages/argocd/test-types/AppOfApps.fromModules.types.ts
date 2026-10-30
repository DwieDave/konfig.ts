import type { Dep, Manifest } from "@konfig.ts/core"
import type { Effect } from "effect"
import type * as ApplicationNS from "../src/Application"
import * as AppOfAppsNS from "../src/AppOfApps"

type Expect<T extends true> = T

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

type _AppOfAppsResult = AppOfAppsNS.AppOfAppsResult

declare const _appOfAppsResult: _AppOfAppsResult

void _appOfAppsResult

type Handle<Name extends string, Out, In> = ApplicationNS.ApplicationHandle<Name, Out, In>

type ProviderH = Handle<
  "image-pulls",
  | Dep.Provide<"App", "image-pulls">
  | Dep.Provide<"Application", "image-pulls">
  | Dep.Provide<"Namespace", "app">
  | Dep.Provide<"Secret", "ghcr-pull">,
  never
>

type ConsumerH = Handle<
  "api",
  | Dep.Provide<"App", "api">
  | Dep.Provide<"Application", "api">
  | Dep.Provide<"Namespace", "app">,
  Dep.Need<"Secret", "ghcr-pull">
>

type LonelyH = Handle<
  "lonely",
  | Dep.Provide<"App", "lonely">
  | Dep.Provide<"Application", "lonely">
  | Dep.Provide<"Namespace", "infra">,
  never
>

type Ok = AppOfAppsNS.ResidualIn<readonly [ProviderH, ConsumerH]>

type _Ok = Expect<Equal<Ok, never>>

type Bad = AppOfAppsNS.ResidualIn<readonly [ConsumerH, ProviderH]>

type _Bad = Expect<Equal<Bad, Dep.Need<"Secret", "ghcr-pull">>>

type Single = AppOfAppsNS.ResidualIn<readonly [LonelyH]>

type _Single = Expect<Equal<Single, never>>

type Missing = AppOfAppsNS.ResidualIn<readonly [ConsumerH]>

type _Missing = Expect<Equal<Missing, Dep.Need<"Secret", "ghcr-pull">>>

declare const provider: ProviderH
declare const consumer: ConsumerH

declare const okProgram: ReturnType<
  typeof AppOfAppsNS.fromModules<readonly [ProviderH, ConsumerH]>
>

type OkR = typeof okProgram extends Effect.Effect<infer _A, infer _E, infer R> ? R : never

type _OkR = Expect<Equal<OkR, Manifest.RenderServices>>

// The return type is sealed even for an unsatisfied tuple — the check lives
// on the options parameter, so instantiating the generic directly still
// yields an R of exactly RenderServices.
declare const badProgram: ReturnType<
  typeof AppOfAppsNS.fromModules<readonly [ConsumerH, ProviderH]>
>

type BadR = typeof badProgram extends Effect.Effect<infer _A, infer _E, infer R> ? R : never

type _BadR = Expect<Equal<BadR, Manifest.RenderServices>>

declare const target: AppOfAppsNS.AppOfAppsTarget

// The residual check fires at the fromModules call itself.
const _okCall = AppOfAppsNS.fromModules({ target, defaults: {}, modules: [provider, consumer] as const })

// @ts-expect-error _konfig_unsatisfied (Secret "ghcr-pull")
const _badCall = AppOfAppsNS.fromModules({ target, defaults: {}, modules: [consumer] as const })

void _okCall

void _badCall

const _legacyCall = AppOfAppsNS.fromModules({
  // @ts-expect-error excess property on target
  target: { repoURL: "x", branch: "main", rootPath: "p" },
  defaults: {},
  modules: [provider] as const
})

void _legacyCall

export type _Tests = readonly [_Ok, _Bad, _Single, _Missing, _OkR, _BadR]
