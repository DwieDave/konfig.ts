import { Helm } from "@konfig.ts/core"
import { Console, Data, Effect } from "effect"
import { Command, Flag } from "effect/cli"
import { loadChartRegistryEffect } from "../chartRegistry"
import { forEachRegistryEntry, loadHelmPaths, toChartRef } from "../helmShared"

export class MissingAllFlag extends Data.TaggedError("MissingAllFlag") {
  get message(): string {
    return "Specify --all to fetch all charts"
  }
}

export const fetchOne = (input: Helm.EnsureChartTarballInput) =>
  Effect.gen(function*() {
    yield* Helm.ensureChartTarball(input)

    if (input.digest === undefined) {
      yield* Console.log(
        `  warning: ${input.chart}@${input.version} has no recorded digest — cached under a plain name that Helm.release's digest-suffixed cache won't reuse`
      )
    }
  })

interface HelmFetchFlags {
  readonly all: boolean
}

export const helmFetchEffect = (flags: HelmFetchFlags) =>
  Effect.gen(function*() {
    if (!flags.all) return yield* new MissingAllFlag()
    const { cacheDir, chartsDir } = yield* loadHelmPaths
    const registry = yield* loadChartRegistryEffect(chartsDir)
    yield* forEachRegistryEntry({
      registry,
      verb: "Fetching",
      run: (entry) => fetchOne(toChartRef({ entry, cacheDir }))
    })
    yield* Console.log(`Done. Cache at ${cacheDir}`)
  })

const helmFetchCommand = Command.make(
  "fetch",
  {
    all: Flag.Boolean("all").pipe(
      Flag.withDescription("Fetch all charts into the local cache"),
      Flag.withDefault(false)
    )
  },
  (flags) => helmFetchEffect(flags)
).pipe(Command.withDescription("Pre-fetch Helm chart tarballs into the local cache"))

export const helmCommand = Command.make("helm", {}, () => Console.log("Run helm --help for available subcommands"))
  .pipe(
    Command.withSubcommands([helmFetchCommand]),
    Command.withDescription("Helm chart management commands")
  )
