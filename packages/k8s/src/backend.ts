import { type Manifest, parseYaml, RenderError } from "@konfig.ts/core"
import type { ResolvedSecretValues, SecretSource } from "@konfig.ts/env"
import { Effect, Redacted, Schema } from "effect"

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
