import { Data, Effect, Option, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { ChartDigest, ChartId, ChartName, ChartRepoUrl, ChartVersion } from "./chartSchemas"

const HELM_RELEASE_MARKER = "_konfigHelmRelease" as const

const ChartRegistryEntrySchema = Schema.Struct({
  id: ChartId,
  repo: ChartRepoUrl,
  chart: ChartName,
  version: ChartVersion,
  digest: Schema.optional(ChartDigest)
})

export type ChartRegistryEntry = typeof ChartRegistryEntrySchema.Type

export class ChartRegistryError extends Data.TaggedError("ChartRegistryError")<{
  readonly chartsDir: string
  readonly cause: unknown
}> {
  get message(): string {
    return `cannot load chart registry from ${this.chartsDir}: ${String(this.cause)}`
  }
}

export class ChartRegistryEntryDecodeError extends Data.TaggedError("ChartRegistryEntryDecodeError")<{
  readonly file: string
  readonly cause: unknown
}> {
  get message(): string {
    return `malformed chart registry entry in ${this.file}: ${String(this.cause)}`
  }
}

const HelmReleaseExportSchema = Schema.Struct({
  [HELM_RELEASE_MARKER]: Schema.Literal(true),
  id: Schema.optional(Schema.Unknown),
  repo: Schema.optional(Schema.Unknown),
  chart: Schema.optional(Schema.Unknown),
  version: Schema.optional(Schema.Unknown),
  digest: Schema.optional(Schema.Unknown)
})

const _decodeHelmReleaseExport = Schema.decodeUnknownOption(HelmReleaseExportSchema)

const _decodeEntry = (input: {
  readonly val: typeof HelmReleaseExportSchema.Type
  readonly file: string
  readonly defaultId: string
}) =>
  Schema.decodeUnknownEffect(ChartRegistryEntrySchema)({
    id: input.val.id ?? input.defaultId,
    repo: input.val.repo,
    chart: input.val.chart,
    version: input.val.version,
    digest: input.val.digest
  }).pipe(
    Effect.mapError((cause) => new ChartRegistryEntryDecodeError({ file: input.file, cause }))
  )

interface _LoadOneInput {
  readonly absPath: string
  readonly file: string
  readonly chartsDir: string
}

const _loadOne = (
  input: _LoadOneInput
): Effect.Effect<ChartRegistryEntry | undefined, ChartRegistryEntryDecodeError | ChartRegistryError> =>
  Effect.gen(function*() {
    const { absPath, chartsDir, file } = input

    const mod = yield* Effect.tryPromise({
      try: () => import(absPath),
      catch: (cause) => new ChartRegistryError({ chartsDir, cause: `failed to import ${absPath}: ${String(cause)}` })
    })

    const release = Object.values(mod).map((entry) => _decodeHelmReleaseExport(entry)).find(Option.isSome)

    return release === undefined
      ? undefined
      : yield* _decodeEntry({ val: release.value, file, defaultId: file.replace(/\.ts$/, "") })
  })

const _EXCLUDED_SUFFIXES = [".d.ts", ".test.ts", ".spec.ts"] as const

export const _isRegistryFile = (name: string): boolean =>
  name.endsWith(".ts") && !name.startsWith("_") && !_EXCLUDED_SUFFIXES.some((suffix) => name.endsWith(suffix))

export const loadChartRegistryEffect = (
  chartsDir: string
): Effect.Effect<ChartRegistryEntry[], ChartRegistryError | ChartRegistryEntryDecodeError, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path

    const allFiles = yield* fs.readDirectory(chartsDir).pipe(
      Effect.mapError((cause) => new ChartRegistryError({ chartsDir, cause }))
    )

    const files = allFiles.filter(_isRegistryFile)

    const loaded = yield* Effect.forEach(
      files,
      (file) => _loadOne({ absPath: path.resolve(chartsDir, file), file, chartsDir })
    )

    return loaded.filter((entry) => entry !== undefined)
  })
