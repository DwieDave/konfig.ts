import { Helm } from "@konfig.ts/core"
import { Console, Effect } from "effect"
import type { ChartRegistryEntry } from "./chartRegistry"
import { resolveCliPaths } from "./cliConfig"
import { resolveConfig } from "./configResolver"

// Helm commands must keep working outside a konfig project (a bare directory
// of chart definitions plus KONFIG_* env vars) — only a genuinely malformed
// konfig.json (ConfigParseError) should fail; a missing one means "use the
// built-in/env defaults". Not Effect.void: resolveCliPaths needs an actual
// `undefined` value here (ResolvedKonfigConfig | undefined), not `void`.
const resolveOptionalConfig = resolveConfig().pipe(
  // oxlint-disable-next-line effecttsgo/effect-succeed-with-void
  Effect.catchTag("ConfigNotFound", () => Effect.succeed(undefined))
)

export const toChartRef = (input: {
  readonly entry: ChartRegistryEntry
  readonly cacheDir: string
}): Helm.EnsureChartTarballInput => ({
  repo: input.entry.repo,
  chart: input.entry.chart,
  version: input.entry.version,
  cacheDir: input.cacheDir,
  digest: input.entry.digest
})

export const toExtractOptions = (input: {
  readonly entry: ChartRegistryEntry
  readonly outDir: string
  readonly cacheDir: string
}) => ({ ...toChartRef(input), id: input.entry.id, outDir: input.outDir })

export const forEachRegistryEntry = <E, R>(input: {
  readonly registry: ReadonlyArray<ChartRegistryEntry>
  readonly verb: string
  readonly run: (entry: ChartRegistryEntry) => Effect.Effect<void, E, R>
}) =>
  Effect.forEach(
    input.registry,
    (entry) => Console.log(`${input.verb} ${entry.chart}@${entry.version}...`).pipe(Effect.andThen(input.run(entry))),
    { concurrency: 4, discard: true }
  )

export const loadHelmPaths = Effect.gen(function*() {
  const cfg = yield* resolveOptionalConfig
  const paths = yield* resolveCliPaths(cfg)
  yield* Helm.assertMinVersion(paths.minVersion)

  return paths
})
