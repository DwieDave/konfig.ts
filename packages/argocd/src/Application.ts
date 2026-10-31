import {
  type AnyRenderError,
  attachLayerToTag,
  Compose,
  Dep,
  Module,
  omitUndefined,
  unsafeCoerce
} from "@konfig.ts/core"
import { type Context, Layer, Schema } from "effect"

export const ArgoSource = Schema.Struct({
  repoURL: Schema.String,
  targetRevision: Schema.String,
  path: Schema.String
})

export type ArgoSource = typeof ArgoSource.Type

export const SyncPolicy = Schema.Struct({
  automated: Schema.optionalKey(Schema.Struct({
    enabled: Schema.optionalKey(Schema.Boolean),
    prune: Schema.optionalKey(Schema.Boolean),
    selfHeal: Schema.optionalKey(Schema.Boolean),
    allowEmpty: Schema.optionalKey(Schema.Boolean)
  })),
  syncOptions: Schema.optionalKey(Schema.Array(Schema.String)),
  retry: Schema.optionalKey(Schema.Struct({
    limit: Schema.optionalKey(Schema.Finite),
    backoff: Schema.optionalKey(Schema.Struct({
      duration: Schema.optionalKey(Schema.String),
      factor: Schema.optionalKey(Schema.Finite),
      maxDuration: Schema.optionalKey(Schema.String)
    }))
  }))
})

export type SyncPolicy = typeof SyncPolicy.Type

export const Application = Schema.Struct({
  name: Schema.String,
  namespace: Schema.String,
  manifests: Schema.Array(Schema.Unknown),
  source: ArgoSource,
  project: Schema.optionalKey(Schema.String),
  syncPolicy: Schema.optionalKey(SyncPolicy),
  annotations: Schema.optionalKey(Schema.Record(Schema.String, Schema.String))
})

export type Application = typeof Application.Type

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
  ...omitUndefined({ project: opts.project, syncPolicy: opts.syncPolicy, annotations: opts.annotations })
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
  input: { readonly name: Name; readonly namespace: Ns }
): Layer.Layer<Dep.Provide<"Application", Name> | Dep.Provide<"Namespace", Ns>> =>
  Layer.mergeAll(Dep.provideApplication(input.name), Dep.provideNamespace(input.namespace))

const _appOf = <Name extends string, Ns extends string, R, Extra>(
  opts: ApplicationDefineOptions<Name, Ns, R, Extra>
) =>
(manifests: ReadonlyArray<unknown>): Application =>
  make({
    name: opts.name,
    namespace: opts.namespace,
    manifests,
    source: opts.source,
    project: opts.project,
    syncPolicy: opts.syncPolicy,
    annotations: opts.annotations
  })

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
  const tag = Dep.App<Name, Application>(opts.name)

  const layer = Compose.moduleLayer({
    tag,
    build: opts.build,
    toValue: _appOf(opts),
    owns: _ownsLayer({ name: opts.name, namespace: opts.namespace }),
    provides: opts.provides
  })

  return unsafeCoerce<DefinedHandle<Name, Ns, R, Extra>>({
    value: attachLayerToTag({ tag, layer }),
    reason: "narrow generic ApplicationHandle from the attachLayerToTag helper's loose Tag arg"
  })
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
