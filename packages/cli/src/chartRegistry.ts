import { Data, Effect, Option, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { ChartId, ChartName, ChartRepoUrl, ChartVersion } from "./chartSchemas"

const HELM_RELEASE_MARKER = "_konfigHelmRelease" as const

const ChartRegistryEntrySchema = Schema.Struct({
  id: ChartId,
  repo: ChartRepoUrl,
  chart: ChartName,
  version: ChartVersion,
  digest: Schema.String
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

const _decodeEntry = (val: typeof HelmReleaseExportSchema.Type, file: string, defaultId: string) =>
  Schema.decodeUnknownEffect(ChartRegistryEntrySchema)({
    id: val.id ?? defaultId,
    repo: val.repo,
    chart: val.chart,
    version: val.version,
    digest: val.digest ?? ""
  }).pipe(
    Effect.mapError((cause) => new ChartRegistryEntryDecodeError({ file, cause }))
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

    return release === undefined ? undefined : yield* _decodeEntry(release.value, file, file.replace(/\.ts$/, ""))
  })

export const loadChartRegistryEffect = (
  chartsDir: string
): Effect.Effect<ChartRegistryEntry[], ChartRegistryError | ChartRegistryEntryDecodeError, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path

    const allFiles = yield* fs.readDirectory(chartsDir).pipe(
      Effect.mapError((cause) => new ChartRegistryError({ chartsDir, cause }))
    )

    const files = allFiles.filter((f) => f.endsWith(".ts") && !f.startsWith("_"))

    const entries: ChartRegistryEntry[] = []

    for (const file of files) {
      const entry = yield* _loadOne({ absPath: path.resolve(chartsDir, file), file, chartsDir })

      if (entry !== undefined) entries.push(entry)
    }

    return entries
  })
