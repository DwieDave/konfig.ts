import { type PackageManager, ProdInstall } from "../PackageManager"

export const npm: PackageManager = {
  kind: "Npm",
  lockfileNames: ["package-lock.json"],
  auxFiles: [".npmrc"],
  installCommand: ["npm", "ci", "--ignore-scripts"],
  prodInstall: ProdInstall.Rewrite({ command: ["npm", "install", "--ignore-scripts", "--omit=dev"] }),
  nodeModulesLayout: "hoisted",
  prependDepsRuns: () => []
}
