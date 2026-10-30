import { Helm } from "@konfig.ts/core"
import { Console, Data, Effect } from "effect"
import { Command, Flag } from "effect/cli"
import { type ChartRegistryEntry, loadChartRegistryEffect } from "../chartRegistry"
import { digestOf, loadHelmPaths } from "../helmShared"

export class MissingAllFlag extends Data.TaggedError("MissingAllFlag") {}

interface FetchOneInput {
  readonly repo: string
  readonly chart: string
  readonly version: string
  readonly cacheDir: string
  // Chart registry entries without a recorded digest fetch under the plain
  // `<chart>-<version>.tgz` name, which `Helm.release`'s digest-suffixed
  // cache (Helm.cacheFileName) can't reuse — see the warning below.
  readonly digest?: string
}

export const _fetchOne = (input: FetchOneInput) =>
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

const _fetchDef = (input: { readonly def: ChartRegistryEntry; readonly cacheDir: string }) =>
  Effect.gen(function*() {
    const { def, cacheDir } = input
    yield* Console.log(`Fetching ${def.chart}@${def.version}...`)
    yield* _fetchOne({ repo: def.repo, chart: def.chart, version: def.version, cacheDir, digest: digestOf(def) })
  })

export const helmFetchEffect = (flags: HelmFetchFlags) =>
  Effect.gen(function*() {
    const { cacheDir, chartsDir } = yield* loadHelmPaths
    if (!flags.all) {
      yield* Console.error("Specify --all to fetch all charts")
      return yield* new MissingAllFlag()
    }
    const registry = yield* loadChartRegistryEffect(chartsDir)
    yield* Effect.forEach(registry, (def) => _fetchDef({ def, cacheDir }), { concurrency: 4, discard: true })
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
