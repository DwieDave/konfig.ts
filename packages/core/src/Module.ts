import { Effect, type Layer } from "effect"
import { unsafeCoerce } from "./_cast"
import type { AnyRenderError } from "./RenderError"

// Forces name/namespace fields to stay literal: the dep graph keys providers by literal
// name, so a widened `string` would silently collapse distinct modules into one slot.
// The conditional keeps T in both branches, so LiteralName<T> is assignable to T even
// while deferred inside a generic body, and generic wrappers can forward
// `LiteralName<Name>` into `define` (conditional-to-conditional inference unifies the
// type parameters, unlike an intersection guard, which re-wraps and never unifies).
export type LiteralName<T extends string> = string extends T ? T & {
    readonly _konfig_error:
      "Module name/namespace must be a string literal. Make the wrapper generic (`<const Name extends string>`) and forward via `Module.LiteralName<Name>`."
  }
  : T

// Single audited coercion for the T -> LiteralName<T> direction: with a concrete
// literal T the conditional collapses to T, but inside a generic body TS keeps the
// conditional deferred and cannot verify it. (LiteralName<T> -> T needs no witness:
// both branches are assignable to T.)
export const asLiteralName = <T extends string>(value: T): LiteralName<T> =>
  unsafeCoerce<LiteralName<T>>(
    value,
    "T extends string; for any literal instantiation LiteralName<T> = T, and non-literal T is rejected at the wrapper call site"
  )

export interface BuildContext<Ns extends string = string> {
  readonly name: string
  readonly namespace: Ns
}

export type BuildResult<A = unknown, R = never> =
  | Effect.Effect<ReadonlyArray<A>, AnyRenderError, R>
  | ReadonlyArray<A>

const _liftBuild = <A, R>(
  result: BuildResult<A, R>
): Effect.Effect<ReadonlyArray<A>, AnyRenderError, R> => Effect.isEffect(result) ? result : Effect.succeed(result)

// HKT encoding: each backend maps (_Name, _Ns, _R, _Extra) to its native handle type.
export interface HandleKind {
  readonly _Name: string
  readonly _Ns: string
  readonly _R: unknown
  readonly _Extra: unknown
  readonly Handle: unknown
}

export type ApplyHandle<
  K extends HandleKind,
  Name extends string,
  Ns extends string,
  R,
  Extra
> = (K & {
  readonly _Name: Name
  readonly _Ns: Ns
  readonly _R: R
  readonly _Extra: Extra
})["Handle"]

export interface DefineBaseArgs<
  Name extends string,
  Ns extends string,
  R,
  Extra
> {
  readonly name: LiteralName<Name>
  readonly namespace: LiteralName<Ns>
  readonly build:
    | Effect.Effect<ReadonlyArray<unknown>, AnyRenderError, R>
    | (() => ReadonlyArray<unknown>)
  readonly provides?: Layer.Layer<Extra>
}

// Adapter contract a backend implements to plug into `Module.fixedNs` / `Module.dynamicNs`.
export interface Target<
  Kind extends HandleKind = HandleKind,
  ExtraConfig extends object = Record<string, never>,
  ExtraCallArgs extends object = Record<string, never>
> {
  readonly define: <
    const Name extends string,
    const Ns extends string,
    R = never,
    Extra = never
  >(
    args: DefineBaseArgs<Name, Ns, R, Extra> & ExtraConfig & ExtraCallArgs
  ) => ApplyHandle<Kind, Name, Ns, R, Extra>
}

export interface FixedNsConfig<
  Kind extends HandleKind,
  ExtraConfig extends object,
  ExtraCallArgs extends object,
  Ns extends string,
  Opts extends object,
  R,
  Extra,
  A = unknown
> {
  readonly target: Target<Kind, ExtraConfig, ExtraCallArgs>
  readonly namespace: Ns
  readonly provides?: Layer.Layer<Extra>
  readonly build: (ctx: BuildContext<Ns>, opts: Opts) => BuildResult<A, R>
}

// Wrapper for a module whose namespace is fixed (baked into the wrapper, not per-instance).
export const fixedNs = <
  Kind extends HandleKind,
  ExtraConfig extends object,
  ExtraCallArgs extends object,
  const Ns extends string,
  Opts extends object = Record<never, never>,
  R = never,
  Extra = never
>(
  config: FixedNsConfig<Kind, ExtraConfig, ExtraCallArgs, Ns, Opts, R, Extra> & ExtraConfig
) => {
  const { build, namespace, provides, target, ...extraConfig } = config

  return <const Name extends string>(
    args: { readonly name: LiteralName<Name> } & ExtraCallArgs & Opts
  ): ApplyHandle<Kind, Name, Ns, R, Extra> => {
    const buildResult = build({ name: args.name, namespace }, args)

    return target.define<Name, Ns, R, Extra>(unsafeCoerce<
      DefineBaseArgs<Name, Ns, R, Extra> & ExtraConfig & ExtraCallArgs
    >(
      {
        ...extraConfig,
        ...args,
        name: args.name,
        namespace: asLiteralName(namespace),
        build: _liftBuild(buildResult),
        ...(provides !== undefined ? { provides } : {})
      },
      "spreads of generic rest/args cannot be re-related to the intersection by TS; unsound only if Opts redeclares a DefineBaseArgs key with a different type"
    ))
  }
}

export interface DynamicNsConfig<
  Kind extends HandleKind,
  ExtraConfig extends object,
  ExtraCallArgs extends object,
  Opts extends object,
  R,
  Extra,
  A = unknown
> {
  readonly target: Target<Kind, ExtraConfig, ExtraCallArgs>
  readonly provides?: Layer.Layer<Extra>
  readonly build: (ctx: BuildContext, opts: Opts) => BuildResult<A, R>
}

// Wrapper for a module whose namespace is chosen per instance.
export const dynamicNs = <
  Kind extends HandleKind,
  ExtraConfig extends object,
  ExtraCallArgs extends object,
  Opts extends object = Record<never, never>,
  R = never,
  Extra = never
>(
  config: DynamicNsConfig<Kind, ExtraConfig, ExtraCallArgs, Opts, R, Extra> & ExtraConfig
) => {
  const { build, provides, target, ...extraConfig } = config

  return <const Name extends string, const Ns extends string>(
    args:
      & {
        readonly name: LiteralName<Name>
        readonly namespace: LiteralName<Ns>
      }
      & ExtraCallArgs
      & Opts
  ): ApplyHandle<Kind, Name, Ns, R, Extra> => {
    const buildResult = build({ name: args.name, namespace: args.namespace }, args)

    return target.define<Name, Ns, R, Extra>(unsafeCoerce<
      DefineBaseArgs<Name, Ns, R, Extra> & ExtraConfig & ExtraCallArgs
    >(
      {
        ...extraConfig,
        ...args,
        build: _liftBuild(buildResult),
        ...(provides !== undefined ? { provides } : {})
      },
      "spreads of generic rest/args cannot be re-related to the intersection by TS; unsound only if Opts redeclares a DefineBaseArgs key with a different type"
    ))
  }
}
