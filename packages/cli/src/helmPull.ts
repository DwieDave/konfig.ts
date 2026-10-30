import { Helm, runProcessExit } from "@konfig.ts/core"
import { Data, Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { ChildProcess } from "effect/process"

interface HelmPullChart {
  readonly repo: string
  readonly chart: string
  readonly version: string
}

interface HelmPullOptions {
  readonly destination: string
}

// Callers must pass schema-validated chart fields (see chartSchemas.ts) — this
// helper does no validation of its own.
interface HelmPullCommandInput {
  readonly chart: HelmPullChart
  readonly options: HelmPullOptions
}

const helmPullCommand = ({ chart, options }: HelmPullCommandInput) =>
  ChildProcess.make("helm", [
    "pull",
    "--repo",
    chart.repo,
    chart.chart,
    "--version",
    chart.version,
    "--destination",
    options.destination
  ])

class HelmPullOutputError extends Data.TaggedError("HelmPullOutputError")<{
  readonly chart: string
  readonly version: string
  readonly found: number
}> {
  get message(): string {
    return `helm pull of ${this.chart}@${this.version} produced ${this.found} tarball(s), expected exactly 1`
  }
}

export interface EnsureChartTarballInput {
  readonly chart: HelmPullChart
  readonly cacheDir: string
  readonly digest?: string
}

const _pullIntoSlot = (input: EnsureChartTarballInput & { readonly slot: string }) =>
  Effect.gen(function*() {
    const { cacheDir, chart, digest, slot } = input
    const fs = yield* FileSystem
    const path = yield* Path
    const pullDir = yield* fs.makeTempDirectory({ directory: cacheDir, prefix: ".konfig-helm-pull-" })
    yield* Effect.gen(function*() {
      yield* runProcessExit(helmPullCommand({ chart, options: { destination: pullDir } }), {
        timeout: yield* Helm.timeout
      })
      const tarballs = (yield* fs.readDirectory(pullDir)).filter((f) => f.endsWith(".tgz"))
      const [pulled] = tarballs
      if (tarballs.length !== 1 || pulled === undefined) {
        return yield* new HelmPullOutputError({ chart: chart.chart, version: chart.version, found: tarballs.length })
      }
      const pulledPath = path.join(pullDir, pulled)
      if (digest !== undefined) {
        yield* Helm.verifyChartDigest({ chart: chart.chart, version: chart.version, digest, cachedTgz: pulledPath })
      }
      yield* fs.rename(pulledPath, slot)
    }).pipe(Effect.ensuring(fs.remove(pullDir, { recursive: true, force: true }).pipe(Effect.ignore)))
  })

export const ensureChartTarball = (input: EnsureChartTarballInput) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    yield* fs.makeDirectory(input.cacheDir, { recursive: true })
    const slot = path.join(
      input.cacheDir,
      Helm.cacheFileName({ chart: input.chart.chart, version: input.chart.version, digest: input.digest })
    )
    const cached = yield* fs.exists(slot)
    if (!cached) yield* _pullIntoSlot({ ...input, slot })
    return slot
  })
