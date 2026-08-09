import { type Effect, Layer } from "effect"
import { unsafeCoerce } from "./_cast"
import type { Need } from "./deps"
import type { RenderServices } from "./Manifest"
import type { AnyRenderError } from "./RenderError"

// oxlint-disable-next-line app/no-type-assertion
export interface ComposeHandle<Out = any, In = any> {
  readonly layer: Layer.Layer<Out, AnyRenderError, In>
}

// `any` (not `unknown`) needed: Layer is contravariant here, invariant at the inference site.
// oxlint-disable-next-line app/no-type-assertion
type AnyHandle = ComposeHandle<any, any>

// oxlint-disable-next-line app/no-type-assertion
type OutOfHandle<H> = H extends ComposeHandle<infer Out, any> ? Out : never
// oxlint-disable-next-line app/no-type-assertion
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
type UniqueKinds = "App" | "Secret" | "SecretValues" | "ConfigMap" | "ServiceAccount" | "Pvc" | "Image"

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

export const composeLayers = (
  modules: ReadonlyArray<{ readonly layer: unknown }>
): Layer.Layer<never, AnyRenderError, never> => {
  type AnyLayer = Layer.Layer<never, AnyRenderError, never>
  return modules.reduce<AnyLayer>(
    (acc, mod) =>
      unsafeCoerce<AnyLayer>(
        Layer.provideMerge(
          unsafeCoerce<AnyLayer>(
            mod.layer,
            "handle.layer carries its narrow type at the call site; the fold collapses to AnyLayer here"
          ),
          acc
        ),
        "Layer.provideMerge's return type is per-call; the fold accumulator stays AnyLayer"
      ),
    unsafeCoerce<AnyLayer>(
      Layer.empty,
      "Layer.empty has type Layer<never, never, never>; widening to AnyLayer is a no-op at runtime"
    )
  )
}

type UnsatisfiedHint<R, Api extends string> = R extends Need<infer K, infer V>
  ? `Missing provider for ${K} "${V}". Add a module that provides it to ${Api}({ modules }), or check that providers come before consumers in the list.`
  : "Unsatisfied dep — see the Effect Layer error above."

type ResidualHintCheck<R, Api extends string> = [Exclude<R, RenderServices>] extends [never] ? unknown
  : {
    readonly _konfig_unsatisfied: UnsatisfiedHint<
      Exclude<R, RenderServices>,
      Api
    >
  }

export const makeResidualEntrypoint = <const Api extends string>(_api: Api) =>
<A, E, R>(
  program: Effect.Effect<A, E, R> & ResidualHintCheck<R, Api>
): Effect.Effect<A, E, R & RenderServices> =>
  unsafeCoerce<Effect.Effect<A, E, R & RenderServices>>(
    program,
    "ResidualHintCheck is a phantom intersection; once the call typechecks, the runtime value is the original Effect"
  )
