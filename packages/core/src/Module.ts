import { Effect, type Layer } from "effect"
import { unsafeCoerce } from "./_cast"
import type { AnyRenderError } from "./RenderError"

/**
 * Resolves to `T` if it is a string literal (or template-literal
 * pattern), and to a structured error type when `T` widens to the bare
 * `string`. Use as the field type on every name/namespace slot any
 * module wrapper forwards.
 *
 * konfig's dep graph keys each provider by literal name; a wrapper that
 * lets `Name` widen to `string` collapses every module into the same
 * slot and silently masks unmet deps. This brand turns that into a
 * compile error at the call site.
 */
export type LiteralName<T extends string> = string extends T ? {
    readonly _konfig_error:
      "Module name/namespace must be a string literal. Make the wrapper generic (`<const Name extends string>`) and forward via `Module.LiteralName<Name>`."
  }
  : T

/**
 * Context passed to a module's `build` callback. Carries the
 * per-instance identity (chosen `name` and the module's `namespace`)
 * so the build can stamp them onto manifests without re-receiving
 * them via `opts`.
 */
export interface BuildContext<Ns extends string = string> {
  readonly name: string
  readonly namespace: Ns
}

/**
 * Allowed return shapes from a module `build` callback:
 *  - an `Effect` (when the build reads from Layers, files, etc.)
 *  - a plain `ReadonlyArray<unknown>` for pure synchronous builds.
 *
 * `Module.fixedNs` / `Module.dynamicNs` lift the array form into an
 * `Effect` internally — wrapper authors don't need to wrap themselves.
 */
export type BuildResult<R = never> =
  | Effect.Effect<ReadonlyArray<unknown>, AnyRenderError, R>
  | ReadonlyArray<unknown>

const _liftBuild = <R>(
  result: BuildResult<R>
): Effect.Effect<ReadonlyArray<unknown>, AnyRenderError, R> => Effect.isEffect(result) ? result : Effect.succeed(result)

/**
 * Higher-kinded handle constructor: each backend declares a sub-interface
 * that maps the four type parameters (`_Name`, `_Ns`, `_R`, `_Extra`)
 * onto its native handle (`ApplicationHandle` / `BundleHandle` / …).
 *
 * `ApplyHandle` substitutes concrete types into the kind's `this`
 * slots — the standard "type lambda" encoding Effect uses for HKTs.
 */
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

/**
 * Universal define-args every backend accepts. Each backend layers
 * additional fields on via the `ExtraConfig` (config-time-only) and
 * `ExtraCallArgs` (per-instance) generics on `Target`.
 */
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

/**
 * Adapter contract a backend implements to plug into `Module.fixedNs` /
 * `Module.dynamicNs`. Both `Application` (argocd) and `Bundle` (k8s)
 * satisfy it via their existing `define` exports — pass the namespace
 * itself as the first argument.
 *
 *  - `Kind`            — HKT mapping `(Name, Ns, R, Extra)` to the
 *                          backend's native handle type.
 *  - `ExtraConfig`     — config-time-only fields the backend accepts
 *                          (e.g. argocd's `syncPolicy`, `annotations`).
 *  - `ExtraCallArgs`   — per-instance fields the wrapper requires
 *                          at the call site (e.g. argocd's `source`).
 */
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

/** Config accepted by `Module.fixedNs` (namespace baked into the wrapper). */
export interface FixedNsConfig<
  Kind extends HandleKind,
  ExtraConfig extends object,
  ExtraCallArgs extends object,
  Ns extends string,
  Opts extends object,
  R,
  Extra
> {
  readonly target: Target<Kind, ExtraConfig, ExtraCallArgs>
  readonly namespace: Ns
  readonly provides?: Layer.Layer<Extra>
  readonly build: (ctx: BuildContext<Ns>, opts: Opts) => BuildResult<R>
}

/**
 * Build a typed wrapper for a module whose namespace is part of its
 * identity (e.g. `cert-manager` always installs into `cert-manager`).
 *
 * `target` is the backend adapter — typically `Application.target`
 * (argocd) or `Bundle.target` (k8s). The wrapper's call signature
 * merges the backend's per-instance fields (`source` for argocd,
 * none for bundle) with the user-defined `Opts`.
 *
 * ```ts
 * const defineSops = Module.fixedNs({
 *   target: Application.target,
 *   namespace: "sops",
 *   annotations: Sync.wave(-1),
 *   build: ({ namespace }, _opts: Record<never, never>) => [
 *     Namespace.make({ name: namespace }),
 *     Helm.release({ ... }),
 *   ],
 * });
 *
 * const sops = defineSops({ name: "sops-operator", source: src("sops") });
 * ```
 */
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

/** Config accepted by `Module.dynamicNs` (namespace chosen per instance). */
export interface DynamicNsConfig<
  Kind extends HandleKind,
  ExtraConfig extends object,
  ExtraCallArgs extends object,
  Opts extends object,
  R,
  Extra
> {
  readonly target: Target<Kind, ExtraConfig, ExtraCallArgs>
  readonly provides?: Layer.Layer<Extra>
  readonly build: (ctx: BuildContext, opts: Opts) => BuildResult<R>
}

/**
 * Build a typed wrapper for a module whose namespace is chosen per
 * instance (e.g. an `api` module deployed into different namespaces
 * per env).
 *
 * ```ts
 * const defineApi = Module.dynamicNs({
 *   target: Application.target,
 *   annotations: Sync.wave(1),
 *   build: ({ name, namespace }, opts: ApiOpts) => [ ... ],
 * });
 *
 * const api = defineApi({
 *   name: "api",
 *   namespace: "prod",
 *   source: src("api"),
 *   replicas: 2,
 * });
 * ```
 */
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
