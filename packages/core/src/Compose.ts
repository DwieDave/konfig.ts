import { type Effect, Layer } from "effect"
import { unsafeCoerce } from "./_cast"
import type { Need } from "./deps"
import type { RenderServices } from "./Manifest"
import type { AnyRenderError } from "./RenderError"

/**
 * The minimal shape `composeLayers` and the residual fold need: anything
 * with a `.layer` field of the standard `(Out, AnyRenderError, In)`
 * triple. Each runtime (argocd `ApplicationHandle`, k8s `BundleHandle`,
 * …) supplies its own wider handle interface — the carried value type
 * is irrelevant to the fold itself.
 */
// oxlint-disable-next-line app/no-type-assertion
export interface ComposeHandle<Out = any, In = any> {
  readonly layer: Layer.Layer<Out, AnyRenderError, In>
}

// `any` in the AnyHandle upper bound: Effect's Layer is contravariant in
// its first parameter and `ComposeHandle` is invariant at the inference
// site. `unknown` rejects concrete subtypes; `any` is bivariant — the
// canonical "any handle" upper bound.
// oxlint-disable-next-line app/no-type-assertion
type AnyHandle = ComposeHandle<any, any>

// oxlint-disable-next-line app/no-type-assertion
type OutOfHandle<H> = H extends ComposeHandle<infer Out, any> ? Out : never
// oxlint-disable-next-line app/no-type-assertion
type InOfHandle<H> = H extends ComposeHandle<any, infer In> ? In : never

/**
 * Left-fold over the modules tuple, mirroring the runtime
 * `reduce(Layer.provideMerge)` below. Each module's `In` is filtered
 * against the union of every *prior* module's `Out`; whatever survives
 * is residual. Tuple order matters: a consumer listed before its
 * provider leaves its Need in the residual.
 */
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

/**
 * After folding `Layer.provideMerge` over `Ms` in tuple order, the
 * leftover `RIn` channel — the Needs that no preceding module's Out
 * satisfies. Pair with `makeResidualEntrypoint` to surface a non-empty
 * residual as a compile error at the entrypoint call site.
 */
export type ResidualIn<T extends ReadonlyArray<AnyHandle>> = FoldResidualIn<T, never, never>

/**
 * Provide kinds that must be unique within one composition. Excluded:
 * `"Namespace"` (two apps sharing a namespace is normal) and
 * `"Application"` (argocd emits it pairwise with `"App"` — including
 * it would double-report every app collision).
 */
type UniqueKinds = "App" | "Secret" | "SecretValues" | "ConfigMap" | "ServiceAccount" | "Pvc" | "Image"

type UniqueOut<H> = Extract<OutOfHandle<H>, Need<UniqueKinds, string>>

/**
 * Left-fold over the modules tuple accumulating each module's unique
 * Provides; any overlap with the accumulator is a duplicate — at
 * runtime `Layer.provideMerge` would let the later module silently
 * shadow the earlier one. Detection must happen on the tuple: once the
 * per-module Out channels union away (e.g. in the folded R channel at
 * the entrypoint), the duplication information is gone.
 */
type FoldDuplicates<
  T extends ReadonlyArray<AnyHandle>,
  AccOut,
  Dups
> = T extends readonly [infer H, ...infer Rest extends ReadonlyArray<AnyHandle>]
  ? FoldDuplicates<Rest, AccOut | UniqueOut<H>, Dups | Extract<UniqueOut<H>, AccOut>>
  : Dups

/**
 * The unique Provides claimed by more than one module in `T`, in tuple
 * order. `never` when every provider name is distinct.
 */
export type DuplicateProvides<T extends ReadonlyArray<AnyHandle>> = FoldDuplicates<T, never, never>

type DuplicateHint<D, Api extends string> = D extends Need<infer K, infer N>
  ? `Duplicate ${K} "${N}": two modules in ${Api}({ modules }) provide the same name; the later one silently shadows the earlier. Rename one of them.`
  : never

/**
 * Intersects the options argument with a phantom `_konfig_duplicate`
 * object when two modules in `Ms` provide the same unique name. The
 * options literal has no such property, so the call fails to typecheck
 * and the user sees the hint — same pattern as `ResidualHintCheck`.
 */
export type NoDuplicateProvides<
  Ms extends ReadonlyArray<AnyHandle>,
  Api extends string
> = [DuplicateProvides<Ms>] extends [never] ? unknown
  : {
    readonly _konfig_duplicate: DuplicateHint<DuplicateProvides<Ms>, Api>
  }

/**
 * Runtime layer composition — `reduce(Layer.provideMerge)`. Each
 * successive module receives every prior module's Out as available
 * services. The runtime type collapses to a bottom Layer; the per-module
 * Out/In is tracked statically by `ResidualIn`.
 */
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

/**
 * Per-Need template-literal hint shown when a residual reaches the
 * entrypoint. `Api` is the calling API's name ("AppOfApps.fromModules",
 * "Bundle.fromModules", …) so the message points the user at the right
 * call site.
 */
type UnsatisfiedHint<R, Api extends string> = R extends Need<infer K, infer V>
  ? `Missing provider for ${K} "${V}". Add a module that provides it to ${Api}({ modules }), or check that providers come before consumers in the list.`
  : "Unsatisfied dep — see the Effect Layer error above."

/**
 * Intersects the program type with a phantom `_konfig_unsatisfied`
 * object when the residual `R` carries anything beyond
 * `Manifest.RenderServices`. The program has no such property at runtime,
 * so the call fails to typecheck and the user sees the hint.
 */
type ResidualHintCheck<R, Api extends string> = [Exclude<R, RenderServices>] extends [never] ? unknown
  : {
    readonly _konfig_unsatisfied: UnsatisfiedHint<
      Exclude<R, RenderServices>,
      Api
    >
  }

/**
 * Build an `entrypoint` function bound to a specific API name. The
 * returned function accepts only programs whose `R` channel reduces to
 * `Manifest.RenderServices`; otherwise the call fails at the program
 * argument with a `_konfig_unsatisfied` hint that names the missing
 * provider and the calling API.
 */
export const makeResidualEntrypoint = <const Api extends string>(_api: Api) =>
<A, E, R>(
  program: Effect.Effect<A, E, R> & ResidualHintCheck<R, Api>
): Effect.Effect<A, E, R & RenderServices> =>
  unsafeCoerce<Effect.Effect<A, E, R & RenderServices>>(
    program,
    "ResidualHintCheck is a phantom intersection; once the call typechecks, the runtime value is the original Effect"
  )
