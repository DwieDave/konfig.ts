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

interface ResolveInput {
  readonly cfg: ResolvedKonfigConfig | undefined
  readonly path: Path
  readonly configured: string | undefined
  readonly fallback: string
}

// `path.resolve` (not `join`) so an absolute konfig.json value (e.g. a shared
// `/var/cache/helm`) is honored as-is instead of being nested under configDir.
const _resolve = ({ cfg, configured, fallback, path }: ResolveInput): string =>
  path.resolve(cfg?.configDir ?? "", configured ?? fallback)

/**
 * Resolves the Helm cache dir, CRD codegen out dir, chart registry dir, and
 * minimum Helm version, in that precedence: env var (`KONFIG_*`) > the
 * matching `konfig.json` field > the built-in default. Relative values and
 * defaults resolve against the konfig.json directory when one exists, else
 * against `process.cwd()`.
 *
 * Pass the `ResolvedKonfigConfig` from `resolveConfig()` when a konfig.json
 * was found; pass `undefined` when commands must keep working outside a
 * konfig project (e.g. `konfig helm fetch` / `konfig crd extract` run from a
 * plain directory of chart definitions) — every path then resolves against
 * `process.cwd()`.
 */
export const resolveCliPaths = (cfg?: ResolvedKonfigConfig) =>
  Effect.gen(function*() {
    const path = yield* Path

    const cacheDir = yield* Config.String(KONFIG_HELM_CACHE_ENV).pipe(
      Config.withDefault(
        _resolve({ cfg, path, configured: cfg?.config.helm?.cacheDir, fallback: DEFAULT_HELM_CACHE_DIR })
      )
    )

    const outDir = yield* Config.String(KONFIG_CRD_OUT_DIR_ENV).pipe(
      Config.withDefault(_resolve({ cfg, path, configured: cfg?.config.crd?.outDir, fallback: DEFAULT_CRD_OUT_DIR }))
    )

    const chartsDir = yield* Config.String(KONFIG_CHARTS_DIR_ENV).pipe(
      Config.withDefault(_resolve({ cfg, path, configured: cfg?.config.charts, fallback: DEFAULT_CHARTS_DIR }))
    )

    const minVersion = yield* Config.String(KONFIG_HELM_MIN_VERSION_ENV).pipe(
      Config.withDefault(cfg?.config.helm?.minVersion ?? DEFAULT_HELM_MIN_VERSION)
    )

    return { cacheDir, outDir, chartsDir, minVersion } as const
  })
