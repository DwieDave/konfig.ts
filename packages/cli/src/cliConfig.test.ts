import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect } from "effect"
import { Path } from "effect/Path"
import {
  DEFAULT_CHARTS_DIR,
  DEFAULT_CRD_OUT_DIR,
  DEFAULT_HELM_CACHE,
  DEFAULT_MIN_HELM_VERSION,
  resolveCliPaths
} from "./cliConfig"

/**
 * Overrides are injected via a scoped ConfigProvider rather than mutating
 * `process.env` directly — `it.effect` tests in this file run concurrently,
 * and real env mutation would race across them.
 */
const _withEnv = (env: Record<string, string>) => Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env)))

describe("resolveCliPaths", () => {
  it.effect("resolves defaults relative to process.cwd() when no overrides are configured", () =>
    Effect.gen(function*() {
      const path = yield* Path
      const paths = yield* resolveCliPaths
      expect(paths.cacheDir).toBe(path.resolve(DEFAULT_HELM_CACHE))
      expect(paths.outDir).toBe(path.resolve(DEFAULT_CRD_OUT_DIR))
      expect(paths.chartsDir).toBe(path.resolve(DEFAULT_CHARTS_DIR))
      expect(paths.minVersion).toBe(DEFAULT_MIN_HELM_VERSION)
    }).pipe(_withEnv({}), Effect.provide(NodeServices.layer)))

  it.effect("honors KONFIG_* environment variable overrides", () =>
    Effect.gen(function*() {
      const paths = yield* resolveCliPaths
      expect(paths.cacheDir).toBe("/custom/cache")
      expect(paths.outDir).toBe("/custom/out")
      expect(paths.chartsDir).toBe("/custom/charts")
      expect(paths.minVersion).toBe("3.99.0")
    }).pipe(
      _withEnv({
        KONFIG_HELM_CACHE: "/custom/cache",
        KONFIG_CRD_OUT_DIR: "/custom/out",
        KONFIG_CHARTS_DIR: "/custom/charts",
        KONFIG_HELM_MIN_VERSION: "3.99.0"
      }),
      Effect.provide(NodeServices.layer)
    ))

  it.effect("partial overrides fall back to defaults for the unset variables", () =>
    Effect.gen(function*() {
      const path = yield* Path
      const paths = yield* resolveCliPaths
      expect(paths.minVersion).toBe("3.20.1")
      expect(paths.chartsDir).toBe(path.resolve(DEFAULT_CHARTS_DIR))
      expect(paths.cacheDir).toBe(path.resolve(DEFAULT_HELM_CACHE))
    }).pipe(_withEnv({ KONFIG_HELM_MIN_VERSION: "3.20.1" }), Effect.provide(NodeServices.layer)))
})
