import { type Manifest, parseYaml, RenderError } from "@konfig.ts/core"
import type { ResolvedSecretValues, SecretSource } from "@konfig.ts/env"
import { Effect, Redacted, Schema } from "effect"
import type { Secret as K8sSecret } from "./.generated/k8s-types"
import { toObjectMeta } from "./meta"

export type BackendTag = string

export const stringRecordSchema = Schema.Record(Schema.String, Schema.String)

export const objectMetaSchema = Schema.Struct({
  name: Schema.String,
  namespace: Schema.String,
  labels: Schema.optionalKey(stringRecordSchema),
  annotations: Schema.optionalKey(stringRecordSchema)
})

type YamlDocument = ReturnType<typeof parseYaml>

export const parseYamlWith = <E>(input: {
  readonly text: string
  readonly onError: (cause: unknown) => E
}): Effect.Effect<YamlDocument, E> => Effect.try({ try: () => parseYaml(input.text), catch: input.onError })

export interface EmitInput<N extends string, K extends string, Opts> {
  readonly base: BackendEmitInput<N, K, true>
  readonly opts: Opts
}

export const resolveSource = <K extends string, R>(input: {
  readonly source: SecretSource<K, R>
  readonly label: string
}): Effect.Effect<ResolvedSecretValues<K>, RenderError, R> =>
  input.source.resolve.pipe(
    Effect.mapError(
      (cause) =>
        new RenderError({
          message: `${input.label}: source failed for key "${cause.key}"`,
          cause
        })
    )
  )

export const resolvePlaintext = <N extends string, K extends string>(input: {
  readonly base: BackendEmitInput<N, K, true>
  readonly label: string
}): Effect.Effect<Record<string, string>, RenderError, Manifest.RenderServices> =>
  resolveSource({ source: input.base.source, label: input.label }).pipe(
    Effect.map((resolved) => Object.fromEntries(input.base.keys.map((key) => [key, Redacted.value(resolved[key])])))
  )

export interface BackendEmitInput<
  N extends string,
  K extends string,
  RequiresSource extends boolean = boolean
> {
  readonly name: N
  readonly namespace: string
  readonly keys: ReadonlyArray<K>
  readonly labels?: Readonly<Record<string, string>>
  readonly annotations?: Readonly<Record<string, string>>
  readonly source: RequiresSource extends true ? SecretSource<K, Manifest.RenderServices>
    : SecretSource<K, Manifest.RenderServices> | undefined
}

export interface SecretBackend<
  N extends string,
  K extends string,
  RequiresSource extends boolean = boolean,
  Out = unknown
> {
  readonly _tag: BackendTag
  readonly requiresSource: RequiresSource
  readonly emit: (input: BackendEmitInput<N, K, RequiresSource>) => Manifest.Manifest<Out>
}

interface _MakeBackendInput<N extends string, K extends string, RequiresSource extends boolean, Out> {
  readonly tag: BackendTag
  readonly requiresSource: RequiresSource
  readonly emit: SecretBackend<N, K, RequiresSource, Out>["emit"]
}

export const SecretBackend = {
  make: <N extends string, K extends string, RequiresSource extends boolean, Out = unknown>(
    input: _MakeBackendInput<N, K, RequiresSource, Out>
  ): SecretBackend<N, K, RequiresSource, Out> => ({
    _tag: input.tag,
    requiresSource: input.requiresSource,
    emit: input.emit
  })
}

export const secretMeta = <N extends string, K extends string>(base: BackendEmitInput<N, K>) =>
  toObjectMeta({
    name: base.name,
    namespace: base.namespace,
    labels: base.labels,
    annotations: base.annotations
  })

export const backendLabel = <N extends string, K extends string>(
  input: { readonly tag: BackendTag; readonly base: BackendEmitInput<N, K> }
): string => `${input.tag}(${input.base.namespace}/${input.base.name})`

export const plainSecret = <N extends string, K extends string>(input: {
  readonly base: BackendEmitInput<N, K>
  readonly type?: string
  readonly stringData: Record<string, string>
  readonly immutable?: boolean
}): K8sSecret => ({
  apiVersion: "v1",
  kind: "Secret",
  metadata: secretMeta(input.base),
  type: input.type,
  stringData: input.stringData,
  immutable: input.immutable
})
