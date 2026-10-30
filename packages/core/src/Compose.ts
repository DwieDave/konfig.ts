import { type Context, Effect, Layer } from "effect"
import { unsafeCoerce } from "./_cast"
import type { Need } from "./deps"
import { liftBuild } from "./lift"
import type { RenderServices } from "./Manifest"
import type { AnyRenderError } from "./RenderError"

export interface ComposeHandle<Out = any, In = any> {
  readonly layer: Layer.Layer<Out, AnyRenderError, In>
}

// `any` (not `unknown`) needed: Layer is contravariant here, invariant at the inference site.
type AnyHandle = ComposeHandle<any, any>

type OutOfHandle<H> = H extends ComposeHandle<infer Out, any> ? Out : never

type InOfHandle<H> = H extends ComposeHandle<any, infer In> ? In : never

// Left-fold mirroring the runtime `reduce(Layer.provideMerge)` below: each module's In is
// filtered against every prior module's Out; a consumer listed before its provider leaks a Need.
type FoldResidualIn<
  T extends ReadonlyArray<AnyHandle>,
  AccIn,
  AccOut
> = T extends readonly [infer H, ...infer Rest]
  ? H extends AnyHandle ? Rest extends ReadonlyArray<AnyHandle> ? FoldResidualIn<
        Rest,
        AccIn | Exclude<InOfHandle<H>, AccOut>,
        AccOut | OutOfHandle<H>
      >
    : never
  : never
  : AccIn

export type ResidualIn<T extends ReadonlyArray<AnyHandle>> = FoldResidualIn<T, never, never>

// Namespace and Application excluded: shared namespaces are normal, and Application is
// emitted pairwise with App (would double-report every collision).
type UniqueKinds = "App" | "Secret" | "SecretValues" | "Image"

type UniqueOut<H> = Extract<OutOfHandle<H>, Need<UniqueKinds, string>>

// Must fold over the tuple, not the unioned R channel: once Out channels union away, the
// per-module duplication information is gone.
type FoldDuplicates<
  T extends ReadonlyArray<AnyHandle>,
  AccOut,
  Dups
> = T extends readonly [infer H, ...infer Rest extends ReadonlyArray<AnyHandle>]
  ? FoldDuplicates<Rest, AccOut | UniqueOut<H>, Dups | Extract<UniqueOut<H>, AccOut>>
  : Dups

export type DuplicateProvides<T extends ReadonlyArray<AnyHandle>> = FoldDuplicates<T, never, never>

type DuplicateHint<D, Api extends string> = D extends Need<infer K, infer N>
  ? `Duplicate ${K} "${N}": two modules in ${Api}({ modules }) provide the same name; the later one silently shadows the earlier. Rename one of them.`
  : never

export type NoDuplicateProvides<
  Ms extends ReadonlyArray<AnyHandle>,
  Api extends string
> = [DuplicateProvides<Ms>] extends [never] ? unknown
  : {
    readonly _konfig_duplicate: DuplicateHint<DuplicateProvides<Ms>, Api>
  }

export interface ComposeLayersInput {
  readonly modules: ReadonlyArray<{ readonly layer: unknown }>
  readonly provides?: Layer.Layer<never, AnyRenderError, never> | undefined
}

export const composeLayers = (
  { modules, provides }: ComposeLayersInput
): Layer.Layer<never, AnyRenderError, never> => {
  type AnyLayer = Layer.Layer<never, AnyRenderError, never>

  return modules.reduce<AnyLayer>(
    (acc, mod) =>
      Layer.provideMerge(
        unsafeCoerce<AnyLayer>({
          value: mod.layer,
          reason: "handle.layer carries its narrow type at the call site; the fold collapses to AnyLayer here"
        }),
        acc
      ),
    provides ?? Layer.empty
  )
}

type UnsatisfiedHint<R, Api extends string> = R extends Need<infer K, infer V>
  ? `Missing provider for ${K} "${V}". Add a module that provides it to ${Api}({ modules }), pass it via provides:, or check that providers come before consumers in the list.`
  : "Unsatisfied dep — see the Effect Layer error above."

export type ResidualCheck<R, Api extends string> = [Exclude<R, RenderServices>] extends [never] ? unknown
  : {
    readonly _konfig_unsatisfied: UnsatisfiedHint<
      Exclude<R, RenderServices>,
      Api
    >
  }

export const makeResidualEntrypoint = <const Api extends string>(_api: Api) =>
<A, E, R>(
  program: Effect.Effect<A, E, R> & ResidualCheck<R, Api>
): Effect.Effect<A, E, R & RenderServices> =>
  unsafeCoerce<Effect.Effect<A, E, R & RenderServices>>({
    value: program,
    reason:
      "ResidualHintCheck is a phantom intersection; once the call typechecks, the runtime value is the original Effect"
  })

export interface SealModulesInput<V, R, A> {
  readonly modules: ReadonlyArray<ComposeHandle & Effect.Effect<V, never, R>>
  readonly provides?: Layer.Layer<never, AnyRenderError, never> | undefined
  readonly build: (values: ReadonlyArray<V>) => A
}

// Resolves every module handle against the composed layers and builds the result.
// R is narrowed on the layer (callers prove the residual empty via ResidualCheck).
export const sealModules = <V, R, A>(
  input: SealModulesInput<V, R, A>
): Effect.Effect<A, AnyRenderError, RenderServices> =>
  Effect.forEach(input.modules, (mod) => mod).pipe(
    Effect.map(input.build),
    Effect.provide(
      unsafeCoerce<Layer.Layer<R, AnyRenderError, RenderServices>>({
        value: composeLayers({ modules: input.modules, provides: input.provides }),
        reason:
          "ResidualCheck proved every module Need is provided by the composed layers, whose only remaining input is RenderServices"
      })
    )
  )

export interface ModuleLayerInput<Tag, Value, R, Owns, Extra> {
  readonly tag: Context.Service<Tag, Value>
  readonly build:
    | Effect.Effect<ReadonlyArray<unknown>, AnyRenderError, R>
    | (() => ReadonlyArray<unknown>)
  readonly toValue: (manifests: ReadonlyArray<unknown>) => Value
  readonly owns: Layer.Layer<Owns>
  readonly provides?: Layer.Layer<Extra> | undefined
}

export const moduleLayer = <Tag, Value, R, Owns, Extra = never>(
  input: ModuleLayerInput<Tag, Value, R, Owns, Extra>
) =>
  Layer.effect(input.tag, liftBuild(input.build).pipe(Effect.map(input.toValue))).pipe(
    Layer.provideMerge(Layer.mergeAll(input.owns, input.provides ?? Layer.empty))
  )
