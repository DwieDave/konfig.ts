import type { PackageManager } from "../PackageManager"

export const npm: PackageManager = {
  kind: "Npm",
  lockfileNames: ["package-lock.json"],
  auxFiles: [".npmrc"],
  installCommand: ["npm", "ci", "--ignore-scripts"],
  prodInstallCommand: ["npm", "install", "--ignore-scripts"],
  productionFlag: ["--omit=dev"],
  nodeModulesLayout: "isolated",
  prependDepsRuns: () => []
}
