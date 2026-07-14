import { Config, Effect } from "effect"
import { Path } from "effect/Path"

export const DEFAULT_MIN_HELM_VERSION = "3.16.0"
export const DEFAULT_CRD_OUT_DIR = ".generated/crd"
export const DEFAULT_HELM_CACHE = ".konfig/helm-cache"
export const DEFAULT_CHARTS_DIR = "infra/k8s-konfig/charts"

export const resolveCliPaths = Effect.gen(function*() {
  const path = yield* Path

  const cacheDir = yield* Config.string("KONFIG_HELM_CACHE").pipe(
    Config.withDefault(path.resolve(DEFAULT_HELM_CACHE))
  )
  const outDir = yield* Config.string("KONFIG_CRD_OUT_DIR").pipe(
    Config.withDefault(path.resolve(DEFAULT_CRD_OUT_DIR))
  )
  const chartsDir = yield* Config.string("KONFIG_CHARTS_DIR").pipe(
    Config.withDefault(path.resolve(DEFAULT_CHARTS_DIR))
  )
  const minVersion = yield* Config.string("KONFIG_HELM_MIN_VERSION").pipe(
    Config.withDefault(DEFAULT_MIN_HELM_VERSION)
  )

  return { cacheDir, outDir, chartsDir, minVersion } as const
})
