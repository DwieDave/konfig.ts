import { Helm } from "@konfig.ts/core"
import { Effect } from "effect"
import type { ChartRegistryEntry } from "./chartRegistry"
import { resolveCliPaths } from "./cliConfig"
import { resolveConfig } from "./configResolver"

// The chart registry decodes a missing digest as "" (see chartRegistry.ts);
// treat that the same as "no digest recorded yet" everywhere.
export const digestOf = (entry: { readonly digest: string }): string | undefined =>
  entry.digest === "" ? undefined : entry.digest

// Helm commands must keep working outside a konfig project (a bare directory
// of chart definitions plus KONFIG_* env vars) — only a genuinely malformed
// konfig.json (ConfigParseError) should fail; a missing one means "use the
// built-in/env defaults". Not Effect.void: resolveCliPaths needs an actual
// `undefined` value here (ResolvedKonfigConfig | undefined), not `void`.
const resolveOptionalConfig = resolveConfig().pipe(
  // oxlint-disable-next-line effecttsgo/effect-succeed-with-void
  Effect.catchTag("ConfigNotFound", () => Effect.succeed(undefined))
)

interface ExtractOptionsInput {
  readonly entry: ChartRegistryEntry
  readonly outDir: string
  readonly cacheDir: string
}

export const toExtractOptions = ({ entry, outDir, cacheDir }: ExtractOptionsInput) => ({
  repo: entry.repo,
  chart: entry.chart,
  version: entry.version,
  id: entry.id,
  outDir,
  cacheDir,
  digest: digestOf(entry)
})

export const loadHelmPaths = Effect.gen(function*() {
  const cfg = yield* resolveOptionalConfig
  const paths = yield* resolveCliPaths(cfg)
  yield* Helm.assertMinVersion(paths.minVersion)

  return paths
})
