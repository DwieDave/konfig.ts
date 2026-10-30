import { orElseIfNotFound } from "@konfig.ts/core"
import { Effect, Option } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import type { PlatformError } from "effect/PlatformError"

interface WalkFilesInput {
  readonly dir: string
  readonly skipDir?: (input: { readonly name: string; readonly full: string }) => boolean
}

type WalkEnv = FileSystem | Path

const _statOrNull = ({ full, fs }: { readonly fs: FileSystem; readonly full: string }) =>
  orElseIfNotFound({ effect: fs.stat(full), fallback: null })

const _walkEntry = (
  input: WalkFilesInput & { readonly name: string }
): Effect.Effect<string[], PlatformError, WalkEnv> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const full = path.join(input.dir, input.name)
    const link = yield* Effect.option(fs.readLink(full))
    const stat = yield* _statOrNull({ fs, full })

    if (stat?.type === "File") return [full]

    if (
      Option.isSome(link) || stat?.type !== "Directory" || input.skipDir?.({ name: input.name, full }) === true
    ) return []

    return yield* walkFiles({ dir: full, skipDir: input.skipDir })
  })

export const walkFiles = (input: WalkFilesInput): Effect.Effect<string[], PlatformError, WalkEnv> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const names = yield* orElseIfNotFound({ effect: fs.readDirectory(input.dir), fallback: [] })
    const groups = yield* Effect.forEach(names, (name) => _walkEntry({ ...input, name }))

    return groups.flat()
  })
