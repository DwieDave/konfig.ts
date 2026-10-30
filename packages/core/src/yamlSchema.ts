import { Effect, Schema } from "effect"
import { parseYaml } from "./diff"
import { RenderError } from "./RenderError"

export const stringRecordSchema = Schema.Record(Schema.String, Schema.String)

export const objectMetaSchema = Schema.Struct({
  name: Schema.String,
  namespace: Schema.String,
  labels: Schema.optionalKey(stringRecordSchema),
  annotations: Schema.optionalKey(stringRecordSchema)
})

export interface ParseYamlWithInput<S extends Schema.Decoder<unknown>, E> {
  readonly text: string
  readonly schema: S
  readonly onError: (cause: unknown) => E
}

export const parseYamlWith = <S extends Schema.Decoder<unknown>, E>(
  input: ParseYamlWithInput<S, E>
): Effect.Effect<S["Type"], E, S["DecodingServices"]> =>
  Effect.try({ try: () => parseYaml(input.text), catch: input.onError }).pipe(
    Effect.flatMap((doc) => Schema.decodeEffect(input.schema)(doc).pipe(Effect.mapError(input.onError)))
  )

type YamlDocument = Schema.Schema.Type<typeof Schema.Unknown>

export const decodeYamlOutput = <A, E, R>(input: {
  readonly text: string
  readonly label: string
  readonly what?: string
  readonly decode: (parsed: YamlDocument) => Effect.Effect<A, E, R>
}): Effect.Effect<A, RenderError | E, R> =>
  parseYamlWith({
    text: input.text,
    schema: Schema.Unknown,
    onError: (cause) =>
      new RenderError({
        message: `${input.label}: ${input.what === undefined ? "" : `${input.what} — `}output was not valid YAML`,
        cause
      })
  }).pipe(Effect.flatMap(input.decode))
