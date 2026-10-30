import { Console, Effect, Schema } from "effect"
import { Argument, Command } from "effect/cli"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { decodeField, mapRepoError, parseJson, RepoScriptError, StringRecord, UnknownRecord } from "../lib/repo"

// npm publish ignores publishConfig.exports and src/ is excluded from files[], so the
// bun/source conditions (pointing at ./src/index.ts for dev) must be stripped pre-publish.

export const stripExportsMap = (input: {
  readonly pkg: Record<string, unknown>
  readonly exportsMap: Record<string, unknown> | undefined
  readonly dot: Record<string, string>
  readonly publishConfig: Record<string, unknown>
}): Record<string, unknown> => {
  const { dot, exportsMap, pkg, publishConfig } = input
  const stripped: Record<string, string> = {}
  if (dot.types !== undefined) stripped.types = dot.types
  if (dot.import !== undefined) stripped.import = dot.import
  const next: Record<string, unknown> = { ...pkg, exports: { ...exportsMap, ".": stripped } }
  if (!("exports" in publishConfig)) return next
  const { exports: _removed, ...rest } = publishConfig
  if (Object.keys(rest).length === 0) {
    const { publishConfig: _drop, ...withoutConfig } = next
    return withoutConfig
  }
  return { ...next, publishConfig: rest }
}

const _decodeStripInputs = (input: { readonly pkgJsonPath: string; readonly pkg: Record<string, unknown> }) =>
  Effect.gen(function*() {
    const { pkg, pkgJsonPath } = input
    const exportsMap = yield* decodeField({
      schema: Schema.UndefinedOr(UnknownRecord),
      value: pkg.exports,
      what: `${pkgJsonPath} exports`
    })
    const dot = yield* decodeField({
      schema: Schema.UndefinedOr(StringRecord),
      value: exportsMap?.["."],
      what: `${pkgJsonPath} exports["."]`
    })
    const publishConfig = yield* decodeField({
      schema: Schema.UndefinedOr(UnknownRecord),
      value: pkg.publishConfig,
      what: `${pkgJsonPath} publishConfig`
    })
    return { exportsMap, dot, publishConfig: { ...publishConfig } }
  })

const _strip = Effect.gen(function*() {
  const fs = yield* FileSystem
  const path = yield* Path
  const pkgJsonPath = path.resolve("package.json")
  const backup = `${pkgJsonPath}.prepack-backup`
  const raw = yield* fs.readFileString(pkgJsonPath).pipe(mapRepoError(`cannot read ${pkgJsonPath}`))
  const pkg = yield* parseJson({ file: pkgJsonPath, text: raw })
  const { dot, exportsMap, publishConfig } = yield* _decodeStripInputs({ pkgJsonPath, pkg })
  if (dot === undefined) {
    yield* Console.error(`prepack-exports: ${pkg.name ?? pkgJsonPath} has no exports["."]; nothing to strip`)
    return
  }
  yield* fs.writeFileString(backup, raw).pipe(mapRepoError(`cannot write ${backup}`))
  const next = stripExportsMap({ pkg, exportsMap, dot, publishConfig })
  yield* fs
    .writeFileString(pkgJsonPath, `${JSON.stringify(next, null, 2)}\n`)
    .pipe(mapRepoError(`cannot write ${pkgJsonPath}`))
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
    .pipe(mapRepoError(`cannot read ${backup}`))
  yield* fs
    .writeFileString(pkgJsonPath, raw)
    .pipe(mapRepoError(`cannot write ${pkgJsonPath}`))
  yield* fs
    .remove(backup)
    .pipe(mapRepoError(`cannot remove ${backup}`))
  yield* Console.log(`prepack-exports: restored ${pkgJsonPath} from backup`)
})

export const prepackExportsCommand = Command.make(
  "prepack-exports",
  {
    mode: Argument.String("mode").pipe(
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
