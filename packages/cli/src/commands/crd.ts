import { Helm } from "@konfig.ts/core"
import { Console, Data, Effect, Option, Path } from "effect"
import { Command, Flag } from "effect/cli"
import { loadChartRegistryEffect } from "../chartRegistry"
import { resolveCliPaths } from "../cliConfig"
import { extractCrdsEffect, verifyCrdsEffect } from "../crd/extract"
import { resolveOptionalConfig, toExtractOptions } from "../helmShared"

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

export const crdExtractEffect = (flags: CrdExtractFlags) =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const cfg = yield* resolveOptionalConfig
    const { cacheDir, outDir, chartsDir, minVersion } = yield* resolveCliPaths(cfg)

    yield* Helm.assertMinVersion(minVersion)

    const registry = yield* loadChartRegistryEffect(chartsDir)

    const releaseId = Option.getOrUndefined(flags.release)

    if (releaseId !== undefined) {
      const def = registry.find((r) => r.id === releaseId)
      if (!def) {
        yield* Console.error(
          `Release '${releaseId}' not found in ${chartsDir}. Available: ${registry.map((r) => r.id).join(", ")}`
        )
        return yield* new ReleaseNotFound({ releaseId })
      }
      yield* Console.log(`Extracting CRDs for ${def.chart}@${def.version}...`)
      yield* extractCrdsEffect(toExtractOptions({ entry: def, outDir, cacheDir }))
      yield* Console.log(`Written to ${path.join(outDir, `${def.id}.ts`)}`)
    } else if (flags.all) {
      if (registry.length === 0) {
        yield* Console.log(`No chart definitions found in ${chartsDir}`)
        return
      }
      // Bounded at 4 (same as buildEnv): keeps the helm subprocess count manageable.
      yield* Effect.forEach(
        registry,
        (def) =>
          Effect.gen(function*() {
            yield* Console.log(`Extracting CRDs for ${def.chart}@${def.version}...`)
            yield* extractCrdsEffect(toExtractOptions({ entry: def, outDir, cacheDir }))
          }),
        { concurrency: 4, discard: true }
      )
      yield* Console.log(`Done. Generated files in ${outDir}`)
    } else {
      yield* Console.error("Specify --release <id> or --all")
      return yield* new MissingCrdFlags()
    }
  })

const crdExtractCommand = Command.make("extract", _crdExtractFlags, crdExtractEffect).pipe(
  Command.withDescription("Extract CRD TypeScript types from Helm charts")
)

export const crdVerifyEffect = Effect.gen(function*() {
  const cfg = yield* resolveOptionalConfig
  const { cacheDir, outDir, chartsDir, minVersion } = yield* resolveCliPaths(cfg)

  yield* Helm.assertMinVersion(minVersion)

  const registry = yield* loadChartRegistryEffect(chartsDir)

  if (registry.length === 0) {
    yield* Console.error(`No chart definitions found in ${chartsDir} — nothing to verify`)
    return yield* new EmptyChartRegistry({ chartsDir })
  }

  const releases = registry.map((entry) => toExtractOptions({ entry, outDir, cacheDir }))

  yield* Console.log(`Verifying ${releases.length} chart(s) against ${outDir}...`)

  const drifted = yield* verifyCrdsEffect({ releases, committedDir: outDir })

  if (drifted.length > 0) {
    yield* Console.error(`CRD drift detected in: ${drifted.join(", ")}`)
    yield* Console.error("Run `konfig crd extract --all` to regenerate")
    return yield* new CrdDrift({ drifted })
  } else {
    yield* Console.log("OK — all CRD files match")
  }
})

const crdVerifyCommand = Command.make("verify", {}, () => crdVerifyEffect).pipe(
  Command.withDescription("Verify committed CRD types match current charts")
)

export const crdCommand = Command.make("crd", {}, () => Console.log("Run crd --help for available subcommands")).pipe(
  Command.withSubcommands([crdExtractCommand, crdVerifyCommand]),
  Command.withDescription("CRD codegen commands")
)
