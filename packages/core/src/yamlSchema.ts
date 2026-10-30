import { Effect, Schema } from "effect"
import { parseYaml } from "./diff"

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
