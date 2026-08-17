import { Helm, runProcessExit } from "@konfig.ts/core"
import { Console, Data, Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { Command, Flag } from "../_unstable"
import { loadChartRegistryEffect } from "../chartRegistry"
import { resolveCliPaths } from "../cliConfig"
import { resolveConfig } from "../configResolver"
import { helmPullCommand } from "../helmPull"
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
    const fs = yield* FileSystem
    const path = yield* Path

    yield* fs.makeDirectory(input.cacheDir, { recursive: true })

    if (input.digest === undefined) {
      const cachedTgz = path.join(input.cacheDir, Helm.cacheFileName({ chart: input.chart, version: input.version }))
      const exists = yield* fs.exists(cachedTgz)
      if (!exists) {
        const cmd = helmPullCommand({ chart: input, options: { destination: input.cacheDir } })
        yield* runProcessExit(cmd)
      }
      yield* Console.log(
        `  warning: ${input.chart}@${input.version} has no recorded digest — cached under a plain name that Helm.release's digest-suffixed cache won't reuse`
      )
      return
    }

    const digest = input.digest
    const digestTgz = path.join(
      input.cacheDir,
      Helm.cacheFileName({ chart: input.chart, version: input.version, digest })
    )
    const digestExists = yield* fs.exists(digestTgz)
    if (digestExists) return

    // `helm pull` always writes the plain `<chart>-<version>.tgz` name;
    // pull into a private temp dir, verify against the recorded digest,
    // then rename into the digest-suffixed slot `Helm.release` also caches
    // under, so a later render reuses this fetch instead of re-pulling.
    const pullDir = yield* fs.makeTempDirectory({ directory: input.cacheDir, prefix: ".konfig-helm-fetch-" })
    yield* Effect.gen(function*() {
      const cmd = helmPullCommand({ chart: input, options: { destination: pullDir } })
      yield* runProcessExit(cmd)
      const pulled = path.join(pullDir, Helm.cacheFileName({ chart: input.chart, version: input.version }))
      yield* Helm.verifyChartDigest({
        chart: input.chart,
        version: input.version,
        digest,
        cachedTgz: pulled
      })
      yield* fs.rename(pulled, digestTgz)
    }).pipe(Effect.ensuring(fs.remove(pullDir, { recursive: true, force: true }).pipe(Effect.ignore)))
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

    for (const def of registry) {
      yield* Console.log(`Fetching ${def.chart}@${def.version}...`)
      yield* _fetchOne({
        repo: def.repo,
        chart: def.chart,
        version: def.version,
        cacheDir,
        digest: def.digest === "" ? undefined : def.digest
      })
    }

    yield* Console.log(`Done. Cache at ${cacheDir}`)
  })

const helmFetchCommand = Command.make(
  "fetch",
  {
    all: Flag.boolean("all").pipe(
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
