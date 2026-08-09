import { type Context, Effect, Layer } from "effect"
import { unsafeCoerce } from "./_cast"
import * as Compose from "./Compose"
import * as Dep from "./deps"
import type * as CoreManifest from "./Manifest"
import type * as Module from "./Module"
import type { AnyRenderError } from "./RenderError"

const _attachLayerToTag = <Tag extends object, Out, Err, In>(
  tag: Tag,
  layer: Layer.Layer<Out, Err, In>
): Tag & { readonly layer: Layer.Layer<Out, Err, In> } =>
  unsafeCoerce<Tag & { readonly layer: Layer.Layer<Out, Err, In> }>(
    Object.assign(tag, { layer }),
    "Effect Context.Tag is callable + extensible; Object.assign mutates in place and the cast widens the public type"
  )

export interface Bundle {
  readonly name: string
  readonly namespace?: string
  readonly manifests: ReadonlyArray<unknown>
}

export interface BundleMakeOptions {
  readonly name: string
  readonly namespace?: string
  readonly manifests: ReadonlyArray<unknown>
}

export const make = (opts: BundleMakeOptions): Bundle => ({
  name: opts.name,
  manifests: opts.manifests,
  ...(opts.namespace !== undefined ? { namespace: opts.namespace } : {})
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

export const define = <
  const Name extends string,
  const Ns extends string = never,
  R = never,
  Extra = never
>(
  opts: BundleDefineOptions<Name, Ns, R, Extra>
): BundleHandle<
  Name,
  Dep.Provide<"App", Name> | _NsProvides<Ns> | Extra,
  Exclude<R, _NsExcludes<Ns> | Extra>
> => {
  const name = unsafeCoerce<Name>(
    opts.name,
    "LiteralName<Name> resolves to Name itself once the call typechecks"
  )
  const namespace = opts.namespace === undefined
    ? undefined
    : unsafeCoerce<Ns>(
      opts.namespace,
      "LiteralName<Ns> resolves to Ns itself once the call typechecks"
    )

  const tag = Dep.App<Name, Bundle>(name)

  const nsLayer = namespace === undefined
    ? Layer.empty
    : Layer.succeed(Dep.Namespace(namespace))(namespace)

  const internalLayer = opts.provides !== undefined ? Layer.mergeAll(nsLayer, opts.provides) : nsLayer

  const buildEffect: Effect.Effect<ReadonlyArray<unknown>, AnyRenderError, R> = Effect.isEffect(opts.build)
    ? opts.build
    : Effect.sync(opts.build)

  const bundleLayer = Layer.effect(
    tag,
    buildEffect.pipe(
      Effect.map((manifests) =>
        make({
          name,
          ...(namespace !== undefined ? { namespace } : {}),
          manifests
        })
      )
    )
  ).pipe(Layer.provide(internalLayer))

  const layer = opts.provides !== undefined
    ? Layer.mergeAll(bundleLayer, nsLayer, opts.provides)
    : Layer.mergeAll(bundleLayer, nsLayer)

  return unsafeCoerce<
    BundleHandle<
      Name,
      Dep.Provide<"App", Name> | _NsProvides<Ns> | Extra,
      Exclude<R, _NsExcludes<Ns> | Extra>
    >
  >(
    _attachLayerToTag(tag, layer),
    "narrow generic BundleHandle from the attachLayerToTag helper's loose Tag arg"
  )
}

// Module.Target adapter for Bundle.define; requires namespace (Bundle.define allows optional).
export const target: Module.Target<HandleKind, Record<never, never>, Record<never, never>> = {
  define: <const Name extends string, const Ns extends string, R = never, Extra = never>(
    args: Module.DefineBaseArgs<Name, Ns, R, Extra>
  ) =>
    unsafeCoerce<Module.ApplyHandle<HandleKind, Name, Ns, R, Extra>>(
      define<Name, Ns, R, Extra>(args),
      "target requires namespace so Ns is always a string literal; under that constraint Bundle.define's _NsProvides<Ns> reduces to Provide<\"Namespace\", Ns>, matching HandleKind"
    )
}

export interface BundleSetResult {
  readonly name: string
  readonly bundles: ReadonlyArray<Bundle>
}

export interface BundleSetMakeOptions {
  readonly name?: string
  readonly bundles: ReadonlyArray<Bundle>
}

export const makeSet = (opts: BundleSetMakeOptions): BundleSetResult => ({
  name: opts.name ?? "bundles",
  bundles: opts.bundles
})

export const entrypoint = Compose.makeResidualEntrypoint("Bundle.fromModules")

// `any` (not `unknown`) needed: Layer is contravariant here, invariant at the inference site.
// oxlint-disable-next-line app/no-type-assertion
type AnyHandle = BundleHandle<any, any, any>

export type ResidualIn<T extends ReadonlyArray<AnyHandle>> = Compose.ResidualIn<T>

export interface FromModulesOptions<Ms extends ReadonlyArray<AnyHandle>> {
  readonly name?: string
  readonly modules: Ms
}

// Order matters: list providers before consumers, or the residual leaves an unmet Need.
// Names must be unique or this fails with a `_konfig_duplicate` hint.
export const fromModules = <const Ms extends ReadonlyArray<AnyHandle>>(
  opts: FromModulesOptions<Ms> & Compose.NoDuplicateProvides<Ms, "Bundle.fromModules">
): Effect.Effect<
  BundleSetResult,
  AnyRenderError,
  ResidualIn<Ms> | CoreManifest.RenderServices
> => {
  const program = Effect.gen(function*() {
    const bundles: Bundle[] = []
    for (const mod of opts.modules) {
      const b = yield* mod
      bundles.push(b)
    }
    return makeSet({ name: opts.name, bundles })
  })

  const wired = Compose.composeLayers(opts.modules)

  return unsafeCoerce<
    Effect.Effect<
      BundleSetResult,
      AnyRenderError,
      ResidualIn<Ms> | CoreManifest.RenderServices
    >
  >(
    Effect.provide(program, wired),
    "the runtime Effect is the same; only the static R channel is narrowed to ResidualIn<Ms> by the fold-as-type"
  )
}
