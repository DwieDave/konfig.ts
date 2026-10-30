import { strictParseOptions } from "@konfig.ts/core"
import { Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"

interface ReadJsonFileInput<A, E> {
  readonly path: string
  readonly schema: Schema.Codec<A, unknown>
  readonly onError: (cause: unknown) => E
}

export const readJsonFile = <A, E>(input: ReadJsonFileInput<A, E>): Effect.Effect<A, E, FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const text = yield* fs.readFileString(input.path)

    return yield* Schema.decodeEffect(Schema.fromJsonString(input.schema))(text, strictParseOptions)
  }).pipe(Effect.mapError(input.onError))
