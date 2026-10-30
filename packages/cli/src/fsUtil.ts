import { Effect, Option, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"

export const existsOrFalse = (target: string): Effect.Effect<boolean, never, FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem

    return yield* fs.exists(target).pipe(Effect.orElseSucceed(() => false))
  })

interface FindUpInput<R> {
  readonly from: string
  readonly test: (dir: string) => Effect.Effect<boolean, never, R>
}

export const findUp = <R>(input: FindUpInput<R>): Effect.Effect<Option.Option<string>, never, R | Path> =>
  Effect.gen(function*() {
    const path = yield* Path
    const dir = path.resolve(input.from)

    if (yield* input.test(dir)) return Option.some(dir)
    const parent = path.dirname(dir)

    return parent === dir ? Option.none() : yield* findUp({ ...input, from: parent })
  })

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
