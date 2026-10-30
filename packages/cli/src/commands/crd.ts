import { Console, Data, Effect, Option, Path } from "effect"
import { Command, Flag } from "effect/cli"
import { type ChartRegistryEntry, loadChartRegistryEffect } from "../chartRegistry"
import { extractCrdsEffect, verifyCrdsEffect } from "../crd/extract"
import { forEachRegistryEntry, loadHelmPaths, toExtractOptions } from "../helmShared"

export class ReleaseNotFound extends Data.TaggedError("ReleaseNotFound")<{
  readonly releaseId: string
  readonly chartsDir: string
  readonly available: ReadonlyArray<string>
}> {
  get message(): string {
    return `Release '${this.releaseId}' not found in ${this.chartsDir}. Available: ${this.available.join(", ")}`
  }
}

export class MissingCrdFlags extends Data.TaggedError("MissingCrdFlags") {
  get message(): string {
    return "Specify --release <id> or --all"
  }
}

export class EmptyChartRegistry extends Data.TaggedError("EmptyChartRegistry")<{
  readonly chartsDir: string
}> {
  get message(): string {
    return `no chart definitions found in ${this.chartsDir} — nothing was verified`
  }
}

export class CrdDrift extends Data.TaggedError("CrdDrift")<{
  readonly drifted: ReadonlyArray<string>
}> {
  get message(): string {
    return `CRD drift detected in: ${this.drifted.join(", ")}. Run \`konfig crd extract --all\` to regenerate`
  }
}

const _crdExtractFlags = {
  release: Flag.String("release").pipe(Flag.withDescription("Chart release id"), Flag.optional),
  all: Flag.Boolean("all").pipe(
    Flag.withDescription("Extract for all charts"),
    Flag.withDefault(false)
  )
}

interface CrdExtractFlags {
  readonly release: Option.Option<string>
  readonly all: boolean
}

type ExtractPaths = { readonly outDir: string; readonly cacheDir: string }

const _extractOne = (input: { readonly entry: ChartRegistryEntry } & ExtractPaths) =>
  extractCrdsEffect(toExtractOptions(input))

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

    if (!def) return yield* new ReleaseNotFound({ releaseId, chartsDir, available: registry.map((r) => r.id) })

    yield* forEachRegistryEntry({
      registry: [def],
      verb: "Extracting CRDs for",
      run: (entry) => _extractOne({ entry, outDir, cacheDir: input.cacheDir })
    })
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
    yield* forEachRegistryEntry({
      registry,
      verb: "Extracting CRDs for",
      run: (entry) => _extractOne({ entry, outDir, cacheDir })
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

    return yield* new MissingCrdFlags()
  })

const crdExtractCommand = Command.make("extract", _crdExtractFlags, crdExtractEffect).pipe(
  Command.withDescription("Extract CRD TypeScript types from Helm charts")
)

export const crdVerifyEffect = Effect.gen(function*() {
  const { cacheDir, outDir, chartsDir } = yield* loadHelmPaths
  const registry = yield* loadChartRegistryEffect(chartsDir)

  if (registry.length === 0) return yield* new EmptyChartRegistry({ chartsDir })

  const releases = registry.map((entry) => toExtractOptions({ entry, outDir, cacheDir }))
  yield* Console.log(`Verifying ${releases.length} chart(s) against ${outDir}...`)
  const drifted = yield* verifyCrdsEffect({ releases, committedDir: outDir })

  if (drifted.length === 0) return yield* Console.log("OK — all CRD files match")

  return yield* new CrdDrift({ drifted })
})

const crdVerifyCommand = Command.make("verify", {}, () => crdVerifyEffect).pipe(
  Command.withDescription("Verify committed CRD types match current charts")
)

export const crdCommand = Command.make("crd", {}, () => Console.log("Run crd --help for available subcommands")).pipe(
  Command.withSubcommands([crdExtractCommand, crdVerifyCommand]),
  Command.withDescription("CRD codegen commands")
)
