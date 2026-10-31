import { Console, Effect, Schema } from "effect"
import { Command, Flag } from "effect/cli"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { diffSurface, packageSurface, type SurfaceDiff } from "../lib/apiSurface"
import { mapRepoError, packageInfos, readJson, REPO_ROOT, RepoScriptError } from "../lib/repo"

const API_SURFACE_FILE = "api-surface.json"

const ApiSurface = Schema.Record(Schema.String, Schema.Array(Schema.String))

type ApiSurface = typeof ApiSurface.Type

const _barrelsOf = Effect.gen(function*() {
  const fs = yield* FileSystem
  const path = yield* Path
  const infos = yield* packageInfos

  const candidates = infos.filter((info) => !info.isPrivate).map((info) => ({
    name: info.name,
    barrel: path.join(info.dir, "src", "index.ts")
  }))

  return yield* Effect.filter(candidates, (c) => fs.exists(c.barrel).pipe(mapRepoError(`cannot stat ${c.barrel}`)))
})

const _currentSurface = Effect.gen(function*() {
  const barrels = yield* _barrelsOf

  const entries = yield* Effect.forEach(
    barrels,
    (b) => packageSurface(b.barrel).pipe(Effect.map((names) => [b.name, names] as const))
  )

  return Object.fromEntries(entries)
})

const _readRecorded = (file: string) =>
  readJson(file).pipe(
    Effect.flatMap((raw) => Schema.decodeUnknownEffect(ApiSurface)(raw)),
    mapRepoError(`cannot read ${file}`)
  )

const _diffAll = (input: { readonly recorded: ApiSurface; readonly current: ApiSurface }) =>
  [...new Set([...Object.keys(input.recorded), ...Object.keys(input.current)])].sort().map((pkg) => ({
    pkg,
    diff: diffSurface({ recorded: input.recorded[pkg] ?? [], current: input.current[pkg] ?? [] })
  }))

const _lines = (input: { readonly pkg: string; readonly diff: SurfaceDiff }) => [
  ...input.diff.removed.map((name) => `  - removed  ${input.pkg}: ${name}`),
  ...input.diff.added.map((name) => `  + added    ${input.pkg}: ${name}`)
]

const _report = (diffs: ReadonlyArray<{ readonly pkg: string; readonly diff: SurfaceDiff }>) => {
  const lines = diffs.flatMap(_lines)

  return lines.length === 0
    ? Console.log("api-surface: public API matches api-surface.json")
    : Effect.fail(
      new RepoScriptError({
        message: [
          "public API differs from api-surface.json:",
          ...lines,
          "Removing public API is a breaking change. If intended, record it in CHANGELOG.md and run",
          "`bun scripts/cli.ts api-surface --write`."
        ].join("\n"),
        cause: undefined
      })
    )
}

const _write = (input: { readonly file: string; readonly current: ApiSurface }) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    yield* fs.writeFileString(input.file, `${JSON.stringify(input.current, null, 2)}\n`).pipe(
      mapRepoError(`cannot write ${input.file}`)
    )
    yield* Console.log(`api-surface: wrote ${input.file}`)
  })

const _apiSurfaceEffect = (input: { readonly write: boolean }) =>
  Effect.gen(function*() {
    const path = yield* Path
    const file = path.join(REPO_ROOT, API_SURFACE_FILE)
    const current = yield* _currentSurface

    if (input.write) return yield* _write({ file, current })

    const recorded = yield* _readRecorded(file)

    return yield* _report(_diffAll({ recorded, current }))
  })

export const apiSurfaceCommand = Command.make(
  "api-surface",
  {
    write: Flag.Boolean("write").pipe(
      Flag.withDescription("record the current public API in api-surface.json"),
      Flag.withDefault(false)
    )
  },
  (args) => _apiSurfaceEffect(args)
).pipe(Command.withDescription("Fail when the public API of the published packages differs from api-surface.json"))
