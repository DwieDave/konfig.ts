import { type AnyRenderError, Dep, type Module, unsafeCoerce } from "@konfig.ts/core"
import { type Context, Effect, Layer } from "effect"

/**
 * Mutate-attach a `layer` field to an Effect Context.Tag so that both
 * `yield* handle` (consume the service) and `handle.layer` (provide it
 * into a parent Layer) work off the same object reference. The single
 * unsafe cast in the dep-graph machinery lives here — keep it tested
 * (`Application.test.ts`) so Effect Context internals can move without
 * breaking every define* factory.
 */
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

/**
 * Re-export of {@link Module.LiteralName} — preserved as
 * `Application.LiteralName` so existing wrapper code keeps working.
 * konfig's dependency graph keys every `Provide<"App", Name>` /
 * `Provide<"Application", Name>` slot by literal `Name`; a wrapper that
 * lets `Name` widen to `string` collapses every app into the same slot
 * and silently masks unmet deps. This brand turns that regression into
 * a compile error at the call site — always fix the wrapper, never
 * relax the constraint.
 *
 * Forwarding pattern (no casts needed):
 *   export const defineX = <const Name extends string>(
 *     opts: { appName: Application.LiteralName<Name>; ... },
 *   ) => Application.define({ name: opts.appName, ... });
 */
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

/**
 * Higher-kinded handle constructor that maps `Module`'s
 * `(Name, Ns, R, Extra)` slots onto an `ApplicationHandle`. Lets
 * `Module.fixedNs(Application, …)` / `Module.dynamicNs(Application, …)`
 * return strongly-typed `ApplicationHandle`s without `core` knowing
 * about argocd's types.
 */
export interface HandleKind extends Module.HandleKind {
  readonly Handle: ApplicationHandle<
    this["_Name"] & string,
    | Dep.Provide<"App", this["_Name"] & string>
    | Dep.Provide<"Application", this["_Name"] & string>
    | Dep.Provide<"Namespace", this["_Ns"] & string>
    | (this["_Extra"] & unknown),
    Exclude<
      this["_R"] & unknown,
      | Dep.Need<"Application", this["_Name"] & string>
      | Dep.Need<"Namespace", this["_Ns"] & string>
      | (this["_Extra"] & unknown)
    >
  >
}

/**
 * Extra config-time fields argocd's `define` accepts beyond the
 * universal `name`/`namespace`/`build`/`provides`. Passed to
 * `Module.fixedNs(Application, { ... })` alongside the build callback.
 */
export interface ExtraConfig {
  readonly project?: string
  readonly syncPolicy?: SyncPolicy
  readonly annotations?: Readonly<Record<string, string>>
}

/**
 * Extra per-instance fields the wrapper requires at the call site —
 * argocd needs the Application's git source for every instance.
 */
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

/**
 * `LiteralName<Name>`/`LiteralName<Ns>` are branded strings that resolve
 * back to `Name`/`Ns` once the call typechecks — coerce them to plain
 * literals for use as dep-graph keys.
 */
const _coerceLiteralNames = <Name extends string, Ns extends string>(
  name: LiteralName<Name>,
  namespace: LiteralName<Ns>
): { readonly name: Name; readonly namespace: Ns } => ({
  name: unsafeCoerce<Name>(name, "LiteralName<Name> resolves to Name itself once the call typechecks"),
  namespace: unsafeCoerce<Ns>(namespace, "LiteralName<Ns> resolves to Ns itself once the call typechecks")
})

/** The `App`/`Namespace` slots every `Application.define` instance owns. */
const _ownsLayer = <Name extends string, Ns extends string>(
  name: Name,
  namespace: Ns
): Layer.Layer<Dep.Provide<"Application", Name> | Dep.Provide<"Namespace", Ns>> =>
  Layer.mergeAll(
    Layer.succeed(Dep.Application(name))(name),
    Layer.succeed(Dep.Namespace(namespace))(namespace)
  )

/** Normalize the `build` option (Effect or thunk) into a single Effect. */
const _buildEffect = <R>(
  build: Effect.Effect<ReadonlyArray<unknown>, AnyRenderError, R> | (() => ReadonlyArray<unknown>)
): Effect.Effect<ReadonlyArray<unknown>, AnyRenderError, R> =>
  Effect.isEffect(build) ? build : Effect.sync(build)

/** Build the Layer that produces this instance's `Application` tag value. */
const _appLayer = <Name extends string, Ns extends string, R, Extra, InternalOut>(
  tag: Context.Service<Dep.Need<"App", Name>, Application>,
  names: { readonly name: Name; readonly namespace: Ns },
  opts: ApplicationDefineOptions<Name, Ns, R, Extra>,
  internalLayer: Layer.Layer<InternalOut>
): Layer.Layer<Dep.Need<"App", Name>, AnyRenderError, R | Extra> =>
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
  ).pipe(Layer.provide(internalLayer))

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

  const appLayer = _appLayer(tag, names, opts, internalLayer)

  const layer = opts.provides !== undefined
    ? Layer.mergeAll(appLayer, ownsLayer, opts.provides)
    : Layer.mergeAll(appLayer, ownsLayer)

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

/**
 * `Module.Target` adapter for `Application.define`. Lets
 * `Module.fixedNs(Application.target, …)` / `Module.dynamicNs(Application.target, …)`
 * compose argocd modules with TypeScript inferring `HandleKind` /
 * `ExtraConfig` / `ExtraCallArgs` directly from this value's type
 * (the namespace alone can't drive that inference because the lookup
 * types behind `Module.Target['define']` aren't invertible).
 *
 * ```ts
 * const defineApi = Module.dynamicNs(Application.target, {
 *   build: ({ name, namespace }, opts: ApiOpts) => [ ... ],
 * });
 * ```
 */
export const target: Module.Target<HandleKind, ExtraConfig, ExtraCallArgs> = { define }
