import {
  DEFAULT_CHARTS_DIR,
  DEFAULT_CRD_OUT_DIR,
  DEFAULT_HELM_MIN_VERSION,
  helmCacheDirConfig,
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

const _helmCacheDir = (input: { readonly cfg: ResolvedKonfigConfig | undefined; readonly path: Path }) => {
  const configured = input.cfg?.config.helm?.cacheDir

  return input.cfg === undefined || configured === undefined
    ? helmCacheDirConfig
    : Config.String(KONFIG_HELM_CACHE_ENV).pipe(
      Config.withDefault(input.path.resolve(input.cfg.configDir, configured))
    )
}

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
    const cacheDir = yield* _helmCacheDir({ cfg, path })

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
