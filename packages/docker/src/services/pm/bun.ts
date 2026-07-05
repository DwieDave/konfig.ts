import type { PackageManager } from "../PackageManager"

// Both lockfile formats are valid for Bun. Pre-1.0 / configured-for-binary
// repos ship `bun.lockb`; recent text-format repos ship `bun.lock`.
// `WorkspaceGraph.detectPm` reports which file actually exists, and the
// Dockerfile lowering picks that one rather than copying both.
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
