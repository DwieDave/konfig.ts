import type { PackageManager } from "../PackageManager"

// Both lockfile formats are valid for Bun; detectPm reports which exists.
export const bun: PackageManager = {
  _tag: "Bun",
  lockfileNames: ["bun.lock", "bun.lockb"],
  auxFiles: ["bunfig.toml"],
  installCommand: ["bun", "install", "--ignore-scripts"],
  prodInstallCommand: ["bun", "install", "--ignore-scripts"],
  productionFlag: ["--production"],
  nodeModulesLayout: "isolated",
  depsImage: ({ runtimeImage }) => runtimeImage,
  prependDepsRuns: () => []
}
