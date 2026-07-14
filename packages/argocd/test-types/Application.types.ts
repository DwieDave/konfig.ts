// Compile-time-only assertions for `Application.define`. None of
// these have runtime behavior — failures show up as `tsc --noEmit`
// errors when the type contract drifts. Run via:
//   bun run --cwd packages/argocd type-test

import type { Application as ApplicationNS } from "@konfig.ts/argocd"
import type { AnyRenderError, Dep } from "@konfig.ts/core"
import type { Context, Effect, Layer } from "effect"

type Expect<T extends true> = T
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

type App = ApplicationNS.Application
type ApplicationHandle<Name extends string, Out, In> = ApplicationNS.ApplicationHandle<
  Name,
  Out,
  In
>

// 1 · `define` with no deps and no extras: Out includes the three
//     auto-provides, In is exactly `never`.
declare const trivial: ReturnType<
  typeof ApplicationNS.define<"trivial", "ns", never, never>
>

type TrivialOut =
  | Dep.Provide<"App", "trivial">
  | Dep.Provide<"Application", "trivial">
  | Dep.Provide<"Namespace", "ns">
type _Trivial_Out = Expect<
  Equal<
    typeof trivial extends ApplicationHandle<"trivial", infer O, infer _I> ? O : never,
    TrivialOut
  >
>
type _Trivial_In = Expect<
  Equal<
    typeof trivial extends ApplicationHandle<"trivial", infer _O, infer I> ? I : never,
    never
  >
>

// 2 · `define` with an unmet `Dep.Need<"Secret", "ghcr-pull">` in
//     the build's R channel: `In` carries that Need; Out is the same
//     auto-provides.
declare const needingSecret: ReturnType<
  typeof ApplicationNS.define<"needing", "ns", Dep.Need<"Secret", "ghcr-pull">, never>
>

type _Needing_Out = Expect<
  Equal<
    typeof needingSecret extends ApplicationHandle<"needing", infer O, infer _I> ? O : never,
    | Dep.Provide<"App", "needing">
    | Dep.Provide<"Application", "needing">
    | Dep.Provide<"Namespace", "ns">
  >
>
type _Needing_In = Expect<
  Equal<
    typeof needingSecret extends ApplicationHandle<"needing", infer _O, infer I> ? I : never,
    Dep.Need<"Secret", "ghcr-pull">
  >
>

// 3 · `define` with an `Extra` provider: Out unions Extra; the build's
//     R-channel that mentions any of (Application<Name>, Namespace<Ns>,
//     Extra) is discharged from In.
type ExtraProvide = Dep.Provide<"ConfigMap", "shared">
type R3 =
  | Dep.Need<"Secret", "x">
  | Dep.Need<"Application", "self-discharged">
  | Dep.Need<"Namespace", "ns3">
declare const withExtra: ReturnType<
  typeof ApplicationNS.define<"self-discharged", "ns3", R3, ExtraProvide>
>

type _Extra_Out = Expect<
  Equal<
    typeof withExtra extends ApplicationHandle<"self-discharged", infer O, infer _I> ? O
      : never,
    | Dep.Provide<"App", "self-discharged">
    | Dep.Provide<"Application", "self-discharged">
    | Dep.Provide<"Namespace", "ns3">
    | ExtraProvide
  >
>
type _Extra_In = Expect<
  Equal<
    typeof withExtra extends ApplicationHandle<"self-discharged", infer _O, infer I> ? I
      : never,
    Dep.Need<"Secret", "x">
  >
>

// 4 · An `ApplicationHandle` is Effect-yieldable; the produced
//     value is the `Application` record.
declare const handle: ApplicationHandle<"api", Dep.Provide<"App", "api">, never>

type HandleEffectChannel = typeof handle extends Effect.Effect<infer A, infer _E, infer _R> ? A
  : never
type _Handle_YieldsApp = Expect<Equal<HandleEffectChannel, App>>

type HandleLayer = typeof handle.layer
type _Handle_Layer = Expect<
  Equal<HandleLayer, Layer.Layer<Dep.Provide<"App", "api">, AnyRenderError, never>>
>

// 5 · `ApplicationHandle` is also assignable as a Context.Service tag
//     for `Need<"App", Name>`.
declare const _serviceUse: Context.Service<Dep.Need<"App", "api">, App>
const _serviceCheck: typeof _serviceUse = handle

export type _Tests = readonly [
  _Trivial_Out,
  _Trivial_In,
  _Needing_Out,
  _Needing_In,
  _Extra_Out,
  _Extra_In,
  _Handle_YieldsApp,
  _Handle_Layer
]
void _serviceCheck
