import { Effect, Option } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import type { PlatformError } from "effect/PlatformError"

export const existsOrFalse = (target: string): Effect.Effect<boolean, PlatformError, FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem

    return yield* fs.exists(target).pipe(
      Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(false))
    )
  })

export const readOrEmpty = (target: string): Effect.Effect<string, PlatformError, FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem

    return yield* fs.readFileString(target).pipe(
      Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(""))
    )
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
