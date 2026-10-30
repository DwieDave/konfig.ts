import { existsOrFalse } from "@konfig.ts/core"
import { Data, Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { fileURLToPath } from "node:url"

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url))

export class RepoScriptError extends Data.TaggedError("RepoScriptError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export const mapRepoError = (message: string) =>
  Effect.mapError((cause: unknown) => new RepoScriptError({ message, cause }))

const PackageJson = Schema.StructWithRest(
  Schema.Struct({
    name: Schema.optional(Schema.String),
    version: Schema.optional(Schema.String),
    private: Schema.optional(Schema.Boolean)
  }),
  [Schema.Record(Schema.String, Schema.Unknown)]
)

export type PackageJson = typeof PackageJson.Type

const _JsonPackage = Schema.fromJsonString(PackageJson)

export const parseJson = (input: { readonly file: string; readonly text: string }) =>
  Schema.decodeEffect(_JsonPackage)(input.text).pipe(
    mapRepoError(`cannot parse ${input.file}`)
  )

export const StringRecord = Schema.Record(Schema.String, Schema.String)
export const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown)

export const decodeField = <S extends Schema.Decoder<unknown>>(
  input: { readonly schema: S; readonly value: unknown; readonly what: string }
) =>
  Schema.decodeUnknownEffect(input.schema)(input.value).pipe(
    mapRepoError(`unexpected shape for ${input.what}`)
  )

export const readJson = (file: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem

    const text = yield* fs
      .readFileString(file)
      .pipe(mapRepoError(`cannot read ${file}`))

    return yield* parseJson({ file, text })
  })

/** Packages without a test:coverage script, skipped only where coverage output is read. */
const COVERAGE_EXCLUDED_PACKAGES: ReadonlySet<string> = new Set(["oxc"])

export const packageDirs = Effect.gen(function*() {
  const fs = yield* FileSystem
  const path = yield* Path
  const packagesDir = path.join(REPO_ROOT, "packages")

  const entries = yield* fs
    .readDirectory(packagesDir)
    .pipe(mapRepoError(`cannot list ${packagesDir}`))

  const dirs = entries.slice().sort().map((entry) => path.join(packagesDir, entry))

  return yield* Effect.filter(
    dirs,
    (dir) => existsOrFalse(path.join(dir, "package.json")).pipe(mapRepoError(`cannot stat ${dir}`))
  )
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

const PackageManifest = Schema.Struct({
  name: Schema.String,
  private: Schema.optional(Schema.Boolean),
  scripts: Schema.optional(StringRecord),
  dependencies: Schema.optional(StringRecord),
  devDependencies: Schema.optional(StringRecord),
  peerDependencies: Schema.optional(StringRecord)
})

export interface PackageInfo {
  readonly dir: string
  readonly name: string
  readonly isPrivate: boolean
  readonly scripts: ReadonlySet<string>
  readonly deps: ReadonlySet<string>
}

const _toInfo = (input: { readonly dir: string; readonly raw: unknown }) =>
  decodeField({ schema: PackageManifest, value: input.raw, what: input.dir }).pipe(
    Effect.map((m): PackageInfo => ({
      dir: input.dir,
      name: m.name,
      isPrivate: m.private === true,
      scripts: new Set(Object.keys(m.scripts ?? {})),
      deps: new Set([
        ...Object.keys(m.dependencies ?? {}),
        ...Object.keys(m.devDependencies ?? {}),
        ...Object.keys(m.peerDependencies ?? {})
      ])
    }))
  )

export const packageInfos = Effect.gen(function*() {
  const path = yield* Path
  const dirs = yield* packageDirs

  return yield* Effect.forEach(
    dirs,
    (dir) => readJson(path.join(dir, "package.json")).pipe(Effect.flatMap((raw) => _toInfo({ dir, raw })))
  )
})

export const readRootCatalogs = Effect.gen(function*() {
  const path = yield* Path
  const rootPkg = yield* readJson(path.join(REPO_ROOT, "package.json"))

  const catalog = (yield* decodeField({
    schema: Schema.UndefinedOr(StringRecord),
    value: rootPkg.catalog,
    what: "root catalog"
  })) ?? {}

  const namedCatalogs = (yield* decodeField({
    schema: Schema.UndefinedOr(Schema.Record(Schema.String, StringRecord)),
    value: rootPkg.catalogs,
    what: "root catalogs"
  })) ?? {}

  return { catalog, namedCatalogs }
})
