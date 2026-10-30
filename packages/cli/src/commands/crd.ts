import { Console, Data, Effect, Option, Path } from "effect"
import { Command, Flag } from "effect/cli"
import { type ChartRegistryEntry, loadChartRegistryEffect } from "../chartRegistry"
import { extractCrdsEffect, verifyCrdsEffect } from "../crd/extract"
import { loadHelmPaths, toExtractOptions } from "../helmShared"

export class ReleaseNotFound extends Data.TaggedError("ReleaseNotFound")<{
  readonly releaseId: string
}> {}

export class MissingCrdFlags extends Data.TaggedError("MissingCrdFlags") {}

export class EmptyChartRegistry extends Data.TaggedError("EmptyChartRegistry")<{
  readonly chartsDir: string
}> {
  get message(): string {
    return `no chart definitions found in ${this.chartsDir} — nothing was verified`
  }
}

export class CrdDrift extends Data.TaggedError("CrdDrift")<{
  readonly drifted: ReadonlyArray<string>
}> {}

const _crdExtractFlags = {
  release: Flag.String("release").pipe(Flag.withDescription("Chart release id"), Flag.optional),
  all: Flag.Boolean("all").pipe(
    Flag.withDescription("Extract for all charts"),
    Flag.withDefault(false)
  )
}

export interface CrdExtractFlags {
  readonly release: Option.Option<string>
  readonly all: boolean
}

type ExtractPaths = { readonly outDir: string; readonly cacheDir: string }

const _extractOne = (input: { readonly def: ChartRegistryEntry } & ExtractPaths) =>
  Effect.gen(function*() {
    const { def, outDir, cacheDir } = input
    yield* Console.log(`Extracting CRDs for ${def.chart}@${def.version}...`)
    yield* extractCrdsEffect(toExtractOptions({ entry: def, outDir, cacheDir }))
  })

const _extractRelease = (
  input: {
    readonly releaseId: string
    readonly registry: ReadonlyArray<ChartRegistryEntry>
    readonly chartsDir: string
  } & ExtractPaths
) =>
  Effect.gen(function*() {
    const { releaseId, registry, chartsDir, outDir } = input
    const path = yield* Path.Path
    const def = registry.find((r) => r.id === releaseId)
    if (!def) {
      yield* Console.error(
        `Release '${releaseId}' not found in ${chartsDir}. Available: ${registry.map((r) => r.id).join(", ")}`
      )
      return yield* new ReleaseNotFound({ releaseId })
    }
    yield* _extractOne({ def, outDir, cacheDir: input.cacheDir })
    yield* Console.log(`Written to ${path.join(outDir, `${def.id}.ts`)}`)
  })

const _extractAll = (
  input: {
    readonly registry: ReadonlyArray<ChartRegistryEntry>
    readonly chartsDir: string
  } & ExtractPaths
) =>
  Effect.gen(function*() {
    const { registry, chartsDir, outDir, cacheDir } = input
    if (registry.length === 0) return yield* Console.log(`No chart definitions found in ${chartsDir}`)
    yield* Effect.forEach(registry, (def) => _extractOne({ def, outDir, cacheDir }), {
      concurrency: 4,
      discard: true
    })
    yield* Console.log(`Done. Generated files in ${outDir}`)
  })

export const crdExtractEffect = (flags: CrdExtractFlags) =>
  Effect.gen(function*() {
    const paths = yield* loadHelmPaths
    const registry = yield* loadChartRegistryEffect(paths.chartsDir)
    const releaseId = Option.getOrUndefined(flags.release)
    if (releaseId !== undefined) return yield* _extractRelease({ ...paths, releaseId, registry })
    if (flags.all) return yield* _extractAll({ ...paths, registry })
    yield* Console.error("Specify --release <id> or --all")
    return yield* new MissingCrdFlags()
  })

const crdExtractCommand = Command.make("extract", _crdExtractFlags, crdExtractEffect).pipe(
  Command.withDescription("Extract CRD TypeScript types from Helm charts")
)

export const crdVerifyEffect = Effect.gen(function*() {
  const { cacheDir, outDir, chartsDir } = yield* loadHelmPaths
  const registry = yield* loadChartRegistryEffect(chartsDir)
  if (registry.length === 0) {
    yield* Console.error(`No chart definitions found in ${chartsDir} — nothing to verify`)
    return yield* new EmptyChartRegistry({ chartsDir })
  }
  const releases = registry.map((entry) => toExtractOptions({ entry, outDir, cacheDir }))
  yield* Console.log(`Verifying ${releases.length} chart(s) against ${outDir}...`)
  const drifted = yield* verifyCrdsEffect({ releases, committedDir: outDir })
  if (drifted.length === 0) return yield* Console.log("OK — all CRD files match")
  yield* Console.error(`CRD drift detected in: ${drifted.join(", ")}`)
  yield* Console.error("Run `konfig crd extract --all` to regenerate")
  return yield* new CrdDrift({ drifted })
})

const crdVerifyCommand = Command.make("verify", {}, () => crdVerifyEffect).pipe(
  Command.withDescription("Verify committed CRD types match current charts")
)

export const crdCommand = Command.make("crd", {}, () => Console.log("Run crd --help for available subcommands")).pipe(
  Command.withSubcommands([crdExtractCommand, crdVerifyCommand]),
  Command.withDescription("CRD codegen commands")
)
