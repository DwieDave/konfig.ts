import { type Context, Effect, Layer, Schema } from "effect"
import { unsafeCoerce } from "./_cast"
import * as Compose from "./Compose"
import * as Dep from "./deps"
import { attachLayerToTag } from "./lift"
import type * as CoreManifest from "./Manifest"
import type * as Module from "./Module"
import { omitUndefined } from "./omitUndefined"
import type { AnyRenderError } from "./RenderError"

export const Bundle = Schema.Struct({
  name: Schema.String,
  namespace: Schema.optionalKey(Schema.String),
  manifests: Schema.Array(Schema.Unknown)
})

export type Bundle = typeof Bundle.Type

export interface BundleMakeOptions {
  readonly name: string
  readonly namespace?: string | undefined
  readonly manifests: ReadonlyArray<unknown>
}

export const make = (opts: BundleMakeOptions): Bundle => ({
  name: opts.name,
  ...omitUndefined({ namespace: opts.namespace }),
  manifests: opts.manifests
})

export interface BundleHandle<Name extends string, Out, In> extends Context.Service<Dep.Need<"App", Name>, Bundle> {
  readonly layer: Layer.Layer<Out, AnyRenderError, In>
}

export interface HandleKind extends Module.HandleKind {
  readonly Handle: BundleHandle<
    this["_Name"] & string,
    | Dep.Provide<"App", this["_Name"] & string>
    | Dep.Provide<"Namespace", this["_Ns"] & string>
    | this["_Extra"],
    Exclude<
      this["_R"],
      | Dep.Need<"Namespace", this["_Ns"] & string>
      | this["_Extra"]
    >
  >
}

export type LiteralName<T extends string> = Module.LiteralName<T>

export interface BundleDefineOptions<
  Name extends string,
  Ns extends string,
  R,
  Extra
> {
  readonly name: LiteralName<Name>
  readonly namespace?: LiteralName<Ns>
  readonly build:
    | Effect.Effect<ReadonlyArray<unknown>, AnyRenderError, R>
    | (() => ReadonlyArray<unknown>)
  readonly provides?: Layer.Layer<Extra>
}

type _NsProvides<Ns extends string> = [Ns] extends [never] ? never
  : Dep.Provide<"Namespace", Ns>

type _NsExcludes<Ns extends string> = [Ns] extends [never] ? never
  : Dep.Need<"Namespace", Ns>

const _nsLayer = (namespace: string | undefined) =>
  namespace === undefined ? Layer.empty : Dep.provideNamespace(namespace)

interface DefineLayerInput<Name extends string, R, Extra> {
  readonly tag: Context.Service<Dep.Need<"App", Name>, Bundle>
  readonly namespace: string | undefined
  readonly opts: {
    readonly name: Name
    readonly build:
      | Effect.Effect<ReadonlyArray<unknown>, AnyRenderError, R>
      | (() => ReadonlyArray<unknown>)
    readonly provides?: Layer.Layer<Extra>
  }
}

const _bundleOf = (input: { readonly name: string; readonly namespace: string | undefined }) =>
(
  manifests: ReadonlyArray<unknown>
): Bundle => make({ name: input.name, namespace: input.namespace, manifests })

const _defineLayer = <Name extends string, R, Extra>(input: DefineLayerInput<Name, R, Extra>) =>
  Compose.moduleLayer({
    tag: input.tag,
    build: input.opts.build,
    toValue: _bundleOf({ name: input.opts.name, namespace: input.namespace }),
    owns: _nsLayer(input.namespace),
    provides: input.opts.provides
  })

export type DefinedBundle<Name extends string, Ns extends string, R, Extra> = BundleHandle<
  Name,
  Dep.Provide<"App", Name> | _NsProvides<Ns> | Extra,
  Exclude<R, _NsExcludes<Ns> | Extra>
>

export const define = <
  const Name extends string,
  const Ns extends string = never,
  R = never,
  Extra = never
>(
  opts: BundleDefineOptions<Name, Ns, R, Extra>
): DefinedBundle<Name, Ns, R, Extra> => {
  const name: Name = opts.name
  const tag = Dep.App<Name, Bundle>(name)
  const layer = _defineLayer({ tag, namespace: opts.namespace, opts })

  return unsafeCoerce<DefinedBundle<Name, Ns, R, Extra>>({
    value: attachLayerToTag({ tag, layer }),
    reason: "narrow generic BundleHandle from the attachLayerToTag helper's loose Tag arg"
  })
}

// Module.Target adapter for Bundle.define; requires namespace (Bundle.define allows optional).
export const target: Module.Target<HandleKind, Record<never, never>, Record<never, never>> = {
  define: <const Name extends string, const Ns extends string, R = never, Extra = never>(
    args: Module.DefineBaseArgs<Name, Ns, R, Extra>
  ) =>
    unsafeCoerce<Module.ApplyHandle<HandleKind, Name, Ns, R, Extra>>({
      value: define<Name, Ns, R, Extra>(args),
      reason:
        "target requires namespace so Ns is always a string literal; under that constraint Bundle.define's _NsProvides<Ns> reduces to Provide<\"Namespace\", Ns>, matching HandleKind"
    })
}

export const BundleSetResult = Schema.Struct({
  name: Schema.String,
  bundles: Schema.Array(Bundle)
})

export type BundleSetResult = typeof BundleSetResult.Type

export interface BundleSetMakeOptions {
  readonly name?: string
  readonly bundles: ReadonlyArray<Bundle>
}

export const makeSet = (opts: BundleSetMakeOptions): BundleSetResult => ({
  name: opts.name ?? "bundles",
  bundles: opts.bundles
})

// `any` (not `unknown`) needed: Layer is contravariant here, invariant at the inference site.
type AnyHandle = BundleHandle<any, any, any>

export type ResidualIn<T extends ReadonlyArray<AnyHandle>> = Compose.ResidualIn<T>

export interface FromModulesOptions<Ms extends ReadonlyArray<AnyHandle>, Extra = never> {
  readonly name?: string
  readonly modules: Ms
  readonly provides?: Layer.Layer<Extra>
}

// Order matters: list providers before consumers, or the consumer's Need
// fails right here as _konfig_unsatisfied. Names must be unique or this fails
// with a `_konfig_duplicate` hint. A group-level `provides` layer can satisfy
// needs no module provides. The result is sealed: R is exactly
// RenderServices, no entrypoint wrapper needed.
export const fromModules = <const Ms extends ReadonlyArray<AnyHandle>, Extra = never>(
  opts:
    & FromModulesOptions<Ms, Extra>
    & Compose.NoDuplicateProvides<Ms, "Bundle.fromModules">
    & Compose.ResidualCheck<Exclude<ResidualIn<Ms>, Extra>, "Bundle.fromModules">
): Effect.Effect<BundleSetResult, AnyRenderError, CoreManifest.RenderServices> =>
  Compose.sealModules({
    modules: opts.modules,
    provides: opts.provides,
    build: (bundles) => makeSet({ name: opts.name, bundles })
  })
