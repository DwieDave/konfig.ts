import { unsafeCoerce } from "@konfig.ts/core"
import { Data, Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { ChartId, ChartName, ChartRepoUrl, ChartVersion } from "./chartSchemas"

export const HELM_RELEASE_MARKER = "_konfigHelmRelease" as const

export const ChartRegistryEntrySchema = Schema.Struct({
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
}> {}

export class ChartRegistryEntryDecodeError extends Data.TaggedError("ChartRegistryEntryDecodeError")<{
  readonly file: string
  readonly cause: unknown
}> {
  get message(): string {
    return `malformed chart registry entry in ${this.file}: ${String(this.cause)}`
  }
}

const _hasHelmReleaseMarker = (val: unknown): val is Record<string, unknown> =>
  val !== null &&
  typeof val === "object" &&
  HELM_RELEASE_MARKER in val &&
  unsafeCoerce<Record<string, unknown>>(val, "narrowed by the `in` check above")[HELM_RELEASE_MARKER] === true

const _decodeEntry = (val: Record<string, unknown>, file: string, defaultId: string) =>
  Schema.decodeUnknownEffect(ChartRegistryEntrySchema)({
    id: val.id ?? defaultId,
    repo: val.repo,
    chart: val.chart,
    version: val.version,
    digest: val.digest ?? ""
  }).pipe(
    Effect.mapError((cause) => new ChartRegistryEntryDecodeError({ file, cause }))
  )

const _loadOne = (
  absPath: string,
  file: string
): Effect.Effect<ChartRegistryEntry | undefined, ChartRegistryEntryDecodeError> =>
  Effect.gen(function*() {
    const mod = yield* Effect.tryPromise({
      try: () => import(absPath),
      catch: (cause) => ({ importFailed: true as const, cause })
    }).pipe(
      Effect.tapError((e) =>
        // A chart module that throws on import (syntax/type error, bad side
        // effect) must not silently vanish from the registry — surface it
        // so the operator can see which file failed and why.
        Effect.sync(() =>
          process.stderr.write(`konfig: failed to load chart module ${absPath}: ${String(e.cause)}\n`)
        )
      ),
      Effect.orElseSucceed(() => undefined)
    )
    if (mod === undefined) return undefined

    for (const key of Object.keys(mod)) {
      const val = mod[key]
      if (_hasHelmReleaseMarker(val)) {
        return yield* _decodeEntry(val, file, file.replace(/\.ts$/, ""))
      }
    }
    return undefined
  })

export const loadChartRegistryEffect = (
  chartsDir: string
): Effect.Effect<ChartRegistryEntry[], ChartRegistryError | ChartRegistryEntryDecodeError, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path

    const allFiles = yield* fs.readDirectory(chartsDir).pipe(Effect.orElseSucceed((): string[] => []))
    const files = allFiles.filter((f) => f.endsWith(".ts") && !f.startsWith("_"))

    const entries: ChartRegistryEntry[] = []
    for (const file of files) {
      const entry = yield* _loadOne(path.resolve(chartsDir, file), file)
      if (entry !== undefined) entries.push(entry)
    }
    return entries
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof ChartRegistryEntryDecodeError ? cause : new ChartRegistryError({ chartsDir, cause })
    )
  )
