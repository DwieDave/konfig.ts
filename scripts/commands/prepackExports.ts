import { Console, Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { Argument, Command } from "effect/unstable/cli"
import { parseJson, RepoScriptError } from "../lib/repo"

// npm publish ignores publishConfig.exports and src/ is excluded from files[], so the
// bun/source conditions (pointing at ./src/index.ts for dev) must be stripped pre-publish.

const _strip = Effect.gen(function*() {
  const fs = yield* FileSystem
  const path = yield* Path
  const pkgJsonPath = path.resolve("package.json")
  const backup = `${pkgJsonPath}.prepack-backup`

  const raw = yield* fs
    .readFileString(pkgJsonPath)
    .pipe(Effect.mapError((cause) => new RepoScriptError({ message: `cannot read ${pkgJsonPath}`, cause })))
  const pkg = yield* parseJson(pkgJsonPath, raw)
  const exportsMap = pkg.exports as Record<string, Record<string, string>> | undefined
  const dot = exportsMap?.["."]
  if (dot === undefined) {
    yield* Console.error(`prepack-exports: ${pkg.name ?? pkgJsonPath} has no exports["."]; nothing to strip`)
    return
  }

  yield* fs
    .writeFileString(backup, raw)
    .pipe(Effect.mapError((cause) => new RepoScriptError({ message: `cannot write ${backup}`, cause })))

  const stripped: Record<string, string> = {}
  if (dot.types !== undefined) stripped.types = dot.types
  if (dot.import !== undefined) stripped.import = dot.import
  const next: Record<string, unknown> = { ...pkg, exports: { ...exportsMap, ".": stripped } }

  const publishConfig = { ...(pkg.publishConfig as Record<string, unknown> | undefined) }
  if ("exports" in publishConfig) {
    delete publishConfig.exports
    if (Object.keys(publishConfig).length === 0) {
      delete next.publishConfig
    } else {
      next.publishConfig = publishConfig
    }
  }

  yield* fs
    .writeFileString(pkgJsonPath, `${JSON.stringify(next, null, 2)}\n`)
    .pipe(Effect.mapError((cause) => new RepoScriptError({ message: `cannot write ${pkgJsonPath}`, cause })))
  yield* Console.log(`prepack-exports: stripped bun/source from ${pkg.name} exports`)
})

const _restore = Effect.gen(function*() {
  const fs = yield* FileSystem
  const path = yield* Path
  const pkgJsonPath = path.resolve("package.json")
  const backup = `${pkgJsonPath}.prepack-backup`

  const exists = yield* fs.exists(backup).pipe(Effect.orElseSucceed(() => false))
  if (!exists) {
    yield* Console.error(`prepack-exports: no backup at ${backup}; nothing to restore`)
    return
  }
  const raw = yield* fs
    .readFileString(backup)
    .pipe(Effect.mapError((cause) => new RepoScriptError({ message: `cannot read ${backup}`, cause })))
  yield* fs
    .writeFileString(pkgJsonPath, raw)
    .pipe(Effect.mapError((cause) => new RepoScriptError({ message: `cannot write ${pkgJsonPath}`, cause })))
  yield* fs
    .remove(backup)
    .pipe(Effect.mapError((cause) => new RepoScriptError({ message: `cannot remove ${backup}`, cause })))
  yield* Console.log(`prepack-exports: restored ${pkgJsonPath} from backup`)
})

export const prepackExportsCommand = Command.make(
  "prepack-exports",
  {
    mode: Argument.string("mode").pipe(
      Argument.withDescription(`"strip" before npm pack/publish, "restore" afterwards`)
    )
  },
  ({ mode }) =>
    mode === "strip"
      ? _strip
      : mode === "restore"
      ? _restore
      : Effect.fail(new RepoScriptError({ message: `unknown mode "${mode}" — expected "strip" or "restore"` }))
).pipe(
  Command.withDescription("Rewrite the cwd package's exports map for npm publish (run via prepack/postpack)")
)
