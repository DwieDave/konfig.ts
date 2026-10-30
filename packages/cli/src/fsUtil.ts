import { existsOrFalse, findUp } from "@konfig.ts/core"
import { Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"

export { existsOrFalse, findUp }

interface ReadJsonFileInput<A, E> {
  readonly path: string
  readonly schema: Schema.Codec<A, unknown>
  readonly onError: (cause: unknown) => E
}

const _STRICT = { onExcessProperty: "error" } as const

export const readJsonFile = <A, E>(input: ReadJsonFileInput<A, E>): Effect.Effect<A, E, FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const text = yield* fs.readFileString(input.path)

    return yield* Schema.decodeEffect(Schema.fromJsonString(input.schema))(text, _STRICT)
  }).pipe(Effect.mapError(input.onError))
