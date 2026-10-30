import { Effect, Option } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import type { PlatformError } from "effect/PlatformError"

interface WalkFilesInput {
  readonly dir: string
  readonly skipDir?: (input: { readonly name: string; readonly full: string }) => boolean
}

type WalkEnv = FileSystem | Path

const _orIfNotFound = <A, B, R>(input: { readonly effect: Effect.Effect<A, PlatformError, R>; readonly value: B }) =>
  input.effect.pipe(
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(input.value)),
    Effect.orDie
  )

const _statOrNull = ({ full, fs }: { readonly fs: FileSystem; readonly full: string }) =>
  _orIfNotFound({ effect: fs.stat(full), value: null })

const _walkEntry = (input: WalkFilesInput & { readonly name: string }): Effect.Effect<string[], never, WalkEnv> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const full = path.join(input.dir, input.name)
    const link = yield* Effect.option(fs.readLink(full))
    const stat = yield* _statOrNull({ fs, full })

    if (stat?.type === "File") return [full]

    if (Option.isSome(link) || stat?.type !== "Directory" || input.skipDir?.({ name: input.name, full }) === true) return []

    return yield* walkFiles({ dir: full, skipDir: input.skipDir })
  })

export const walkFiles = (input: WalkFilesInput): Effect.Effect<string[], never, WalkEnv> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const names = yield* _orIfNotFound({ effect: fs.readDirectory(input.dir), value: [] })
    const groups = yield* Effect.forEach(names, (name) => _walkEntry({ ...input, name }))

    return groups.flat()
  })
