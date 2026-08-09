import { Data, Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { fileURLToPath } from "node:url"

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url))

export class RepoScriptError extends Data.TaggedError("RepoScriptError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export const PackageJson = Schema.StructWithRest(
  Schema.Struct({
    name: Schema.optional(Schema.String),
    version: Schema.optional(Schema.String),
    private: Schema.optional(Schema.Boolean)
  }),
  [Schema.Record(Schema.String, Schema.Unknown)]
)

export type PackageJson = typeof PackageJson.Type

const _JsonPackage = Schema.fromJsonString(PackageJson)

export const parseJson = (file: string, text: string) =>
  Schema.decodeEffect(_JsonPackage)(text).pipe(
    Effect.mapError((cause) => new RepoScriptError({ message: `cannot parse ${file}`, cause }))
  )

export const readJson = (file: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const text = yield* fs
      .readFileString(file)
      .pipe(Effect.mapError((cause) => new RepoScriptError({ message: `cannot read ${file}`, cause })))
    return yield* parseJson(file, text)
  })

/** Packages without a test:coverage script, skipped only where coverage output is read. */
const COVERAGE_EXCLUDED_PACKAGES: ReadonlySet<string> = new Set(["oxc"])

export const packageDirs = Effect.gen(function*() {
  const fs = yield* FileSystem
  const path = yield* Path
  const packagesDir = path.join(REPO_ROOT, "packages")
  const entries = yield* fs
    .readDirectory(packagesDir)
    .pipe(Effect.mapError((cause) => new RepoScriptError({ message: `cannot list ${packagesDir}`, cause })))
  const dirs: Array<string> = []
  for (const entry of entries.slice().sort()) {
    const dir = path.join(packagesDir, entry)
    const pkgJson = path.join(dir, "package.json")
    const exists = yield* fs.exists(pkgJson).pipe(Effect.orElseSucceed(() => false))
    if (exists) dirs.push(dir)
  }
  return dirs
})

export const testPackageNames = Effect.gen(function*() {
  const path = yield* Path
  const dirs = yield* packageDirs
  return dirs.map((dir) => path.basename(dir))
})

export const coveragePackageNames = Effect.gen(function*() {
  const names = yield* testPackageNames
  return names.filter((name) => !COVERAGE_EXCLUDED_PACKAGES.has(name))
})
