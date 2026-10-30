import { Console, Data, Effect } from "effect"
import { Command, Flag } from "effect/cli"
import { loadChartRegistryEffect } from "../chartRegistry"
import { resolveCliPaths } from "../cliConfig"
import { resolveConfig } from "../configResolver"
import { ensureChartTarball } from "../helmPull"
import { assertHelmVersion } from "../helmVersion"

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
    yield* ensureChartTarball({
      chart: input,
      cacheDir: input.cacheDir,
      digest: input.digest
    })
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
    // Not Effect.void: resolveCliPaths needs an actual `undefined` value here
    // (ResolvedKonfigConfig | undefined), not `void`.
    // oxlint-disable-next-line effecttsgo/effect-succeed-with-void
    const cfg = yield* resolveConfig().pipe(Effect.catchTag("ConfigNotFound", () => Effect.succeed(undefined)))
    const { cacheDir, chartsDir, minVersion } = yield* resolveCliPaths(cfg)

    yield* assertHelmVersion(minVersion)

    if (!flags.all) {
      yield* Console.error("Specify --all to fetch all charts")
      return yield* new MissingAllFlag()
    }

    const registry = yield* loadChartRegistryEffect(chartsDir)

    // Bounded at 4 (same as buildEnv): keeps the helm subprocess count manageable.
    yield* Effect.forEach(
      registry,
      (def) =>
        Effect.gen(function*() {
          yield* Console.log(`Fetching ${def.chart}@${def.version}...`)
          yield* _fetchOne({
            repo: def.repo,
            chart: def.chart,
            version: def.version,
            cacheDir,
            digest: def.digest === "" ? undefined : def.digest
          })
        }),
      { concurrency: 4, discard: true }
    )

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
