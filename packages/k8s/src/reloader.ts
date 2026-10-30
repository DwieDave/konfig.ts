// See packages/k8s/README.md for the build-time-hash vs runtime-reloader trade-off.
export type ReloaderOption =
  | "off"
  | "stakater"
  | "stakater-strict"
  | {
    readonly secrets?: ReadonlyArray<string>
    readonly configMaps?: ReadonlyArray<string>
  }

export const _reloaderAnnotations = (
  opt: ReloaderOption | undefined
): Readonly<Record<string, string>> => {
  if (opt === undefined || opt === "off") return {}
  if (opt === "stakater") return { "reloader.stakater.com/auto": "true" }
  if (opt === "stakater-strict") {
    return {
      "reloader.stakater.com/auto": "true",
      "reloader.stakater.com/match": "true"
    }
  }
  const out: Record<string, string> = {}
  if (opt.secrets && opt.secrets.length > 0) {
    out["secret.reloader.stakater.com/reload"] = opt.secrets.join(",")
  }
  if (opt.configMaps && opt.configMaps.length > 0) {
    out["configmap.reloader.stakater.com/reload"] = opt.configMaps.join(",")
  }
  return out
}
