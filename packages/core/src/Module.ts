import { Effect, type Layer } from "effect"
import { unsafeCoerce } from "./_cast"
import type { AnyRenderError } from "./RenderError"

// Forces name/namespace fields to stay literal: the dep graph keys providers by literal
// name, so a widened `string` would silently collapse distinct modules into one slot.
export type LiteralName<T extends string> = string extends T ? {
    readonly _konfig_error:
      "Module name/namespace must be a string literal. Make the wrapper generic (`<const Name extends string>`) and forward via `Module.LiteralName<Name>`."
  }
  : T

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
  const { target, namespace, provides, build, ...extraConfig } = unsafeCoerce<
    FixedNsConfig<Kind, ExtraConfig, ExtraCallArgs, Ns, Opts, R, Extra> & ExtraConfig & Record<string, unknown>
  >(config, "Record spread shape mirrors the FixedNsConfig & ExtraConfig intersection")
  const adapter = unsafeCoerce<Target<Kind, ExtraConfig, ExtraCallArgs>>(
    target,
    "target was destructured from config without preserving its typed shape; reattach the constraint"
  )

  return <const Name extends string>(
    args: { readonly name: LiteralName<Name> } & ExtraCallArgs & Opts
  ): ApplyHandle<Kind, Name, Ns, R, Extra> => {
    const { name, ...rest } = unsafeCoerce<
      { readonly name: LiteralName<Name> } & Record<string, unknown>
    >(args, "destructuring the wrapper args; rest carries ExtraCallArgs & Opts as a flat record")

    const ctxName = unsafeCoerce<Name>(
      name,
      "LiteralName<Name> resolves to Name itself once the wrapper call typechecks"
    )

    const buildResult = build(
      { name: ctxName, namespace },
      unsafeCoerce<Opts>(rest, "rest carries Opts fields; ExtraCallArgs flow to target.define below")
    )

    return adapter.define<Name, Ns, R, Extra>(unsafeCoerce<
      DefineBaseArgs<Name, Ns, R, Extra> & ExtraConfig & ExtraCallArgs
    >(
      {
        ...extraConfig,
        ...rest,
        name,
        namespace: unsafeCoerce<LiteralName<Ns>>(
          namespace,
          "Ns is a const string literal; LiteralName<Ns> resolves to Ns itself"
        ),
        build: _liftBuild(buildResult),
        ...(provides !== undefined ? { provides } : {})
      },
      "the assembled object structurally matches the target's define-args; spread layout matches the intersection"
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
  const { target, provides, build, ...extraConfig } = unsafeCoerce<
    DynamicNsConfig<Kind, ExtraConfig, ExtraCallArgs, Opts, R, Extra> & ExtraConfig & Record<string, unknown>
  >(config, "Record spread shape mirrors the DynamicNsConfig & ExtraConfig intersection")
  const adapter = unsafeCoerce<Target<Kind, ExtraConfig, ExtraCallArgs>>(
    target,
    "target was destructured from config without preserving its typed shape; reattach the constraint"
  )

  return <const Name extends string, const Ns extends string>(
    args:
      & {
        readonly name: LiteralName<Name>
        readonly namespace: LiteralName<Ns>
      }
      & ExtraCallArgs
      & Opts
  ): ApplyHandle<Kind, Name, Ns, R, Extra> => {
    const { name, namespace, ...rest } = unsafeCoerce<
      { readonly name: LiteralName<Name>; readonly namespace: LiteralName<Ns> } & Record<string, unknown>
    >(args, "destructuring the wrapper args; rest carries ExtraCallArgs & Opts as a flat record")

    const ctxName = unsafeCoerce<Name>(
      name,
      "LiteralName<Name> resolves to Name itself once the wrapper call typechecks"
    )
    const ctxNs = unsafeCoerce<Ns>(
      namespace,
      "LiteralName<Ns> resolves to Ns itself once the wrapper call typechecks"
    )

    const buildResult = build(
      { name: ctxName, namespace: ctxNs },
      unsafeCoerce<Opts>(rest, "rest carries Opts fields; ExtraCallArgs flow to target.define below")
    )

    return adapter.define<Name, Ns, R, Extra>(unsafeCoerce<
      DefineBaseArgs<Name, Ns, R, Extra> & ExtraConfig & ExtraCallArgs
    >(
      {
        ...extraConfig,
        ...rest,
        name,
        namespace,
        build: _liftBuild(buildResult),
        ...(provides !== undefined ? { provides } : {})
      },
      "the assembled object structurally matches the target's define-args; spread layout matches the intersection"
    ))
  }
}
