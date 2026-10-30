import { Effect, Option } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import type { PlatformError } from "effect/PlatformError"

interface OrElseIfNotFoundInput<A, B, R> {
  readonly effect: Effect.Effect<A, PlatformError, R>
  readonly fallback: B
}

export const orElseIfNotFound = <A, B, R>(
  input: OrElseIfNotFoundInput<A, B, R>
): Effect.Effect<A | B, PlatformError, R> =>
  input.effect.pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(input.fallback)))

export const existsOrFalse = (target: string): Effect.Effect<boolean, PlatformError, FileSystem> =>
  Effect.flatMap(FileSystem, (fs) => fs.exists(target))

export const readOrEmpty = (target: string): Effect.Effect<string, PlatformError, FileSystem> =>
  Effect.flatMap(FileSystem, (fs) => orElseIfNotFound({ effect: fs.readFileString(target), fallback: "" }))

interface FindUpInput<E, R> {
  readonly from: string
  readonly test: (dir: string) => Effect.Effect<boolean, E, R>
}

export const findUp = <E = never, R = never>(
  input: FindUpInput<E, R>
): Effect.Effect<Option.Option<string>, E, R | Path> =>
  Effect.gen(function*() {
    const path = yield* Path
    const dir = path.resolve(input.from)

    if (yield* input.test(dir)) return Option.some(dir)
    const parent = path.dirname(dir)

    return parent === dir ? Option.none() : yield* findUp({ ...input, from: parent })
  })
