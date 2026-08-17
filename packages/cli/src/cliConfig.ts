import {
  DEFAULT_CHARTS_DIR,
  DEFAULT_CRD_OUT_DIR,
  DEFAULT_HELM_CACHE_DIR,
  DEFAULT_HELM_MIN_VERSION,
  KONFIG_CHARTS_DIR_ENV,
  KONFIG_CRD_OUT_DIR_ENV,
  KONFIG_HELM_CACHE_ENV,
  KONFIG_HELM_MIN_VERSION_ENV,
  type ResolvedKonfigConfig
} from "@konfig.ts/core"
import { Config, Effect } from "effect"
import { Path } from "effect/Path"

// Re-exported under their historical cli-local names — @konfig.ts/core's
// konfigDefaults.ts is now the single source of truth for these values,
// shared with the konfig.json schema defaults in konfigConfig.ts.
export const DEFAULT_MIN_HELM_VERSION = DEFAULT_HELM_MIN_VERSION
export const DEFAULT_HELM_CACHE = DEFAULT_HELM_CACHE_DIR
export { DEFAULT_CHARTS_DIR, DEFAULT_CRD_OUT_DIR }

/**
 * Resolves the Helm cache dir, CRD codegen out dir, chart registry dir, and
 * minimum Helm version, in that precedence: env var (`KONFIG_*`) > the
 * matching `konfig.json` field (resolved relative to the config file's own
 * directory, like `root`/`outDir` elsewhere) > the built-in default
 * (resolved relative to `process.cwd()`).
 *
 * Pass the `ResolvedKonfigConfig` from `resolveConfig()` when a konfig.json
 * was found; pass `undefined` when commands must keep working outside a
 * konfig project (e.g. `konfig helm fetch` / `konfig crd extract` run from a
 * plain directory of chart definitions) — every path then falls back to a
 * cwd-relative default.
 */
export const resolveCliPaths = (cfg?: ResolvedKonfigConfig) =>
  Effect.gen(function*() {
    const path = yield* Path

    // `path.resolve` (not `join`) so an absolute konfig.json value (e.g. a
    // shared `/var/cache/helm`) is honored as-is instead of being nested
    // under configDir.
    const _resolve = (configured: string | undefined, fallback: string): string =>
      cfg !== undefined ? path.resolve(cfg.configDir, configured ?? fallback) : path.resolve(fallback)

    const cacheDir = yield* Config.string(KONFIG_HELM_CACHE_ENV).pipe(
      Config.withDefault(_resolve(cfg?.config.helm?.cacheDir, DEFAULT_HELM_CACHE_DIR))
    )
    const outDir = yield* Config.string(KONFIG_CRD_OUT_DIR_ENV).pipe(
      Config.withDefault(_resolve(cfg?.config.crd?.outDir, DEFAULT_CRD_OUT_DIR))
    )
    const chartsDir = yield* Config.string(KONFIG_CHARTS_DIR_ENV).pipe(
      Config.withDefault(_resolve(cfg?.config.charts, DEFAULT_CHARTS_DIR))
    )
    const minVersion = yield* Config.string(KONFIG_HELM_MIN_VERSION_ENV).pipe(
      Config.withDefault(cfg?.config.helm?.minVersion ?? DEFAULT_HELM_MIN_VERSION)
    )

    return { cacheDir, outDir, chartsDir, minVersion } as const
  })
