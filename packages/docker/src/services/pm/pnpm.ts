import type { NodeModulesLayout, PackageManager } from "../PackageManager"

export interface PnpmOptions {
  readonly layout: NodeModulesLayout
}

export const pnpm = (opts: PnpmOptions): PackageManager => ({
  kind: "Pnpm",
  lockfileNames: ["pnpm-lock.yaml"],
  auxFiles: ["pnpm-workspace.yaml", ".npmrc"],
  installCommand: ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"],
  prodInstallCommand: ["pnpm", "install", "--ignore-scripts"],
  productionFlag: ["--prod"],
  nodeModulesLayout: opts.layout,
  prependDepsRuns: (version) => [`corepack enable pnpm && corepack prepare pnpm@${version} --activate`]
})
