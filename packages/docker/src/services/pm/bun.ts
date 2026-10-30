import { type PackageManager, ProdInstall } from "../PackageManager"

// Both lockfile formats are valid for Bun; detectPm reports which exists.
export const bun: PackageManager = {
  kind: "Bun",
  lockfileNames: ["bun.lock", "bun.lockb"],
  auxFiles: ["bunfig.toml"],
  installCommand: ["bun", "install", "--ignore-scripts"],
  prodInstall: ProdInstall.Targeted({
    command: (target) => ["bun", "install", "--ignore-scripts", "--frozen-lockfile", "--production", "--filter", target]
  }),
  nodeModulesLayout: "isolated",
  prependDepsRuns: () => []
}
