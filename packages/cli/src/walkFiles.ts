import { Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"

interface WalkFilesInput {
  readonly dir: string
  readonly skipDir?: (input: { readonly name: string; readonly full: string }) => boolean
}

type WalkEnv = FileSystem | Path

const _statOrNull = ({ full, fs }: { readonly fs: FileSystem; readonly full: string }) =>
  fs.stat(full).pipe(Effect.orElseSucceed(() => null))

const _walkEntry = (input: WalkFilesInput & { readonly name: string }): Effect.Effect<string[], never, WalkEnv> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const full = path.join(input.dir, input.name)
    const link = yield* fs.readLink(full).pipe(Effect.orElseSucceed(() => null))
    const stat = yield* _statOrNull({ fs, full })

    if (stat?.type === "File") return [full]

    if (link !== null || stat?.type !== "Directory" || input.skipDir?.({ name: input.name, full }) === true) return []

    return yield* walkFiles({ dir: full, skipDir: input.skipDir })
  })

export const walkFiles = (input: WalkFilesInput): Effect.Effect<string[], never, WalkEnv> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const names = yield* fs.readDirectory(input.dir).pipe(Effect.orElseSucceed((): string[] => []))
    const groups = yield* Effect.forEach(names, (name) => _walkEntry({ ...input, name }))

    return groups.flat()
  })
