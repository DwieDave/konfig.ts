import { type AnyRenderError, attachLayerToTag, Dep, liftBuild, Module, unsafeCoerce } from "@konfig.ts/core"
import { type Context, Effect, Layer } from "effect"

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

export const make = (opts: Application): Application => ({
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

export interface ApplicationDefineOptions<Name extends string, Ns extends string, R, Extra>
  extends Module.DefineBaseArgs<Name, Ns, R, Extra>, ExtraConfig, ExtraCallArgs
{}

const _ownsLayer = <Name extends string, Ns extends string>(
  name: Name,
  namespace: Ns
): Layer.Layer<Dep.Provide<"Application", Name> | Dep.Provide<"Namespace", Ns>> =>
  Layer.mergeAll(Dep.provideApplication(name), Dep.provideNamespace(namespace))

const _appLayer = <Name extends string, Ns extends string, R, Extra>(
  tag: Context.Service<Dep.Need<"App", Name>, Application>,
  names: { readonly name: Name; readonly namespace: Ns },
  opts: ApplicationDefineOptions<Name, Ns, R, Extra>
): Layer.Layer<Dep.Need<"App", Name>, AnyRenderError, R> =>
  Layer.effect(
    tag,
    liftBuild(opts.build).pipe(
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

type DefinedHandle<Name extends string, Ns extends string, R, Extra> = ApplicationHandle<
  Name,
  | Dep.Provide<"App", Name>
  | Dep.Provide<"Application", Name>
  | Dep.Provide<"Namespace", Ns>
  | Extra,
  Exclude<R, Dep.Need<"Application", Name> | Dep.Need<"Namespace", Ns> | Extra>
>

export const define: Module.Target<HandleKind, ExtraConfig, ExtraCallArgs>["define"] = <
  const Name extends string,
  const Ns extends string,
  R = never,
  Extra = never
>(
  opts: ApplicationDefineOptions<Name, Ns, R, Extra>
): DefinedHandle<Name, Ns, R, Extra> => {
  const names: { readonly name: Name; readonly namespace: Ns } = {
    name: opts.name,
    namespace: opts.namespace
  }
  const tag = Dep.App<Name, Application>(names.name)

  const ownsLayer = _ownsLayer(names.name, names.namespace)
  const internalLayer = opts.provides !== undefined ? Layer.mergeAll(ownsLayer, opts.provides) : ownsLayer

  const appLayer = _appLayer(tag, names, opts)

  const layer = appLayer.pipe(Layer.provideMerge(internalLayer))

  return unsafeCoerce<DefinedHandle<Name, Ns, R, Extra>>(
    attachLayerToTag({ tag, layer }),
    "narrow generic ApplicationHandle from the attachLayerToTag helper's loose Tag arg"
  )
}

export const target: Module.Target<HandleKind, ExtraConfig, ExtraCallArgs> = { define }

// `provides` is spelled out (not derived via Omit<FixedNsConfig, "target">) because an
// Omit over the generic interface stops TS inferring Extra from a bare `Dep.provideSecret(...)`.
export interface ModuleConfig<Ns extends string, Opts extends object, R, Extra> extends ExtraConfig {
  readonly namespace: Ns
  readonly provides?: Layer.Layer<Extra>
  readonly build: (ctx: Module.BuildContext<Ns>, opts: Opts) => Module.BuildResult<unknown, R>
}

// `Module.fixedNs` with `target: Application.target` pre-applied.
export const module = <
  const Ns extends string,
  Opts extends object = Record<never, never>,
  R = never,
  Extra = never
>(
  config: ModuleConfig<Ns, Opts, R, Extra>
) =>
  Module.fixedNs<HandleKind, ExtraConfig, ExtraCallArgs, Ns, Opts, R, Extra>({
    ...config,
    target
  })
