import { Data, Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { fileURLToPath } from "node:url"

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url))

export class RepoScriptError extends Data.TaggedError("RepoScriptError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export interface PackageJson {
  readonly name?: string
  readonly version?: string
  readonly private?: boolean
  readonly [key: string]: unknown
}

const _JsonRecord = Schema.fromJsonString(Schema.Unknown)

export const readJson = (file: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const text = yield* fs
      .readFileString(file)
      .pipe(Effect.mapError((cause) => new RepoScriptError({ message: `cannot read ${file}`, cause })))
    const parsed = yield* Schema.decodeEffect(_JsonRecord)(text).pipe(
      Effect.mapError((cause) => new RepoScriptError({ message: `cannot parse ${file}`, cause }))
    )
    return parsed as PackageJson
  })

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
