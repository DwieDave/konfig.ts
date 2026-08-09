import { type AnyRenderError, Dep, type Module, unsafeCoerce } from "@konfig.ts/core"
import { type Context, Effect, Layer } from "effect"

// Mutate-attach `layer` to the Context.Tag so yield* and .layer share one
// reference; the sole unsafe cast in the dep-graph machinery — kept covered
// by Application.test.ts.
const _attachLayerToTag = <
  Tag extends object,
  Out,
  Err,
  In
>(
  tag: Tag,
  layer: Layer.Layer<Out, Err, In>
): Tag & { readonly layer: Layer.Layer<Out, Err, In> } =>
  unsafeCoerce<Tag & { readonly layer: Layer.Layer<Out, Err, In> }>(
    Object.assign(tag, { layer }),
    "Effect Context.Tag is callable + extensible; Object.assign mutates in place and the cast widens the public type"
  )

export interface ArgoSource {
  readonly repoURL: string
  readonly targetRevision: string
  readonly path: string
}

export interface SyncPolicy {
  readonly automated?: {
    readonly prune?: boolean
    readonly selfHeal?: boolean
    readonly allowEmpty?: boolean
  }
  readonly syncOptions?: ReadonlyArray<string>
  readonly retry?: {
    readonly limit?: number
    readonly backoff?: {
      readonly duration?: string
      readonly factor?: number
      readonly maxDuration?: string
    }
  }
}

export interface Application {
  readonly name: string
  readonly namespace: string
  readonly manifests: ReadonlyArray<unknown>
  readonly source: ArgoSource
  readonly project?: string
  readonly syncPolicy?: SyncPolicy
  readonly annotations?: Readonly<Record<string, string>>
}

export type Any = Application

// Widening Name to string here would collapse every app into the same
// Provide<"App", Name> slot and silently mask unmet deps — this brand turns
// that into a compile error instead.
export type LiteralName<T extends string> = Module.LiteralName<T>

export interface ApplicationMakeOptions {
  readonly name: string
  readonly namespace: string
  readonly manifests: ReadonlyArray<unknown>
  readonly source: ArgoSource
  readonly project?: string
  readonly syncPolicy?: SyncPolicy
  readonly annotations?: Readonly<Record<string, string>>
}

export const make = (opts: ApplicationMakeOptions): Application => ({
  name: opts.name,
  namespace: opts.namespace,
  manifests: opts.manifests,
  source: opts.source,
  ...(opts.project !== undefined ? { project: opts.project } : {}),
  ...(opts.syncPolicy !== undefined ? { syncPolicy: opts.syncPolicy } : {}),
  ...(opts.annotations !== undefined ? { annotations: opts.annotations } : {})
})

export interface ApplicationHandle<Name extends string, Out, In>
  extends Context.Service<Dep.Need<"App", Name>, Application>
{
  readonly layer: Layer.Layer<Out, AnyRenderError, In>
}

export interface HandleKind extends Module.HandleKind {
  readonly Handle: ApplicationHandle<
    this["_Name"] & string,
    | Dep.Provide<"App", this["_Name"] & string>
    | Dep.Provide<"Application", this["_Name"] & string>
    | Dep.Provide<"Namespace", this["_Ns"] & string>
    | this["_Extra"],
    Exclude<
      this["_R"],
      | Dep.Need<"Application", this["_Name"] & string>
      | Dep.Need<"Namespace", this["_Ns"] & string>
      | this["_Extra"]
    >
  >
}

export interface ExtraConfig {
  readonly project?: string
  readonly syncPolicy?: SyncPolicy
  readonly annotations?: Readonly<Record<string, string>>
}

export interface ExtraCallArgs {
  readonly source: ArgoSource
}

export interface ApplicationDefineOptions<Name extends string, Ns extends string, R, Extra> {
  readonly name: LiteralName<Name>
  readonly namespace: LiteralName<Ns>
  readonly source: ArgoSource
  readonly project?: string
  readonly syncPolicy?: SyncPolicy
  readonly annotations?: Readonly<Record<string, string>>
  readonly build:
    | Effect.Effect<ReadonlyArray<unknown>, AnyRenderError, R>
    | (() => ReadonlyArray<unknown>)
  readonly provides?: Layer.Layer<Extra>
}

const _coerceLiteralNames = <Name extends string, Ns extends string>(
  name: LiteralName<Name>,
  namespace: LiteralName<Ns>
): { readonly name: Name; readonly namespace: Ns } => ({
  name: unsafeCoerce<Name>(name, "LiteralName<Name> resolves to Name itself once the call typechecks"),
  namespace: unsafeCoerce<Ns>(namespace, "LiteralName<Ns> resolves to Ns itself once the call typechecks")
})

const _ownsLayer = <Name extends string, Ns extends string>(
  name: Name,
  namespace: Ns
): Layer.Layer<Dep.Provide<"Application", Name> | Dep.Provide<"Namespace", Ns>> =>
  Layer.mergeAll(
    Layer.succeed(Dep.Application(name))(name),
    Layer.succeed(Dep.Namespace(namespace))(namespace)
  )

const _buildEffect = <R>(
  build: Effect.Effect<ReadonlyArray<unknown>, AnyRenderError, R> | (() => ReadonlyArray<unknown>)
): Effect.Effect<ReadonlyArray<unknown>, AnyRenderError, R> => Effect.isEffect(build) ? build : Effect.sync(build)

const _appLayer = <Name extends string, Ns extends string, R, Extra>(
  tag: Context.Service<Dep.Need<"App", Name>, Application>,
  names: { readonly name: Name; readonly namespace: Ns },
  opts: ApplicationDefineOptions<Name, Ns, R, Extra>
): Layer.Layer<Dep.Need<"App", Name>, AnyRenderError, R> =>
  Layer.effect(
    tag,
    _buildEffect(opts.build).pipe(
      Effect.map((manifests) =>
        make({
          name: names.name,
          namespace: names.namespace,
          manifests,
          source: opts.source,
          project: opts.project,
          syncPolicy: opts.syncPolicy,
          annotations: opts.annotations
        })
      )
    )
  )

export const define: Module.Target<HandleKind, ExtraConfig, ExtraCallArgs>["define"] = <
  const Name extends string,
  const Ns extends string,
  R = never,
  Extra = never
>(
  opts: ApplicationDefineOptions<Name, Ns, R, Extra>
): ApplicationHandle<
  Name,
  | Dep.Provide<"App", Name>
  | Dep.Provide<"Application", Name>
  | Dep.Provide<"Namespace", Ns>
  | Extra,
  Exclude<R, Dep.Need<"Application", Name> | Dep.Need<"Namespace", Ns> | Extra>
> => {
  const names = _coerceLiteralNames(opts.name, opts.namespace)
  const tag = Dep.App<Name, Application>(names.name)

  const ownsLayer = _ownsLayer(names.name, names.namespace)
  const internalLayer = opts.provides !== undefined ? Layer.mergeAll(ownsLayer, opts.provides) : ownsLayer

  const appLayer = _appLayer(tag, names, opts)

  const layer = appLayer.pipe(Layer.provideMerge(internalLayer))

  return unsafeCoerce<
    ApplicationHandle<
      Name,
      | Dep.Provide<"App", Name>
      | Dep.Provide<"Application", Name>
      | Dep.Provide<"Namespace", Ns>
      | Extra,
      Exclude<R, Dep.Need<"Application", Name> | Dep.Need<"Namespace", Ns> | Extra>
    >
  >(_attachLayerToTag(tag, layer), "narrow generic ApplicationHandle from the attachLayerToTag helper's loose Tag arg")
}

export const target: Module.Target<HandleKind, ExtraConfig, ExtraCallArgs> = { define }
