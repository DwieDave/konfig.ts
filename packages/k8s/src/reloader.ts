// See packages/k8s/README.md for the build-time-hash vs runtime-reloader trade-off.
export type ReloaderOption =
  | "off"
  | "stakater"
  | {
    readonly secrets?: ReadonlyArray<string>
    readonly configMaps?: ReadonlyArray<string>
  }

const _STAKATER_AUTO = { "reloader.stakater.com/auto": "true" }

const _listAnnotation = (entry: readonly [string, ReadonlyArray<string> | undefined]) =>
  entry[1] !== undefined && entry[1].length > 0 ? [[entry[0], entry[1].join(",")]] : []

export const _reloaderAnnotations = (opt: ReloaderOption | undefined) => {
  if (opt === undefined || opt === "off") return {}

  if (opt === "stakater") return _STAKATER_AUTO

  return Object.fromEntries([
    ..._listAnnotation(["secret.reloader.stakater.com/reload", opt.secrets]),
    ..._listAnnotation(["configmap.reloader.stakater.com/reload", opt.configMaps])
  ])
}
