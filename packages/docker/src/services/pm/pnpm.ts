import { type NodeModulesLayout, type PackageManager, ProdInstall } from "../PackageManager"

export interface PnpmOptions {
  readonly layout: NodeModulesLayout
}

export const pnpm = (opts: PnpmOptions): PackageManager => ({
  kind: "Pnpm",
  lockfileNames: ["pnpm-lock.yaml"],
  auxFiles: ["pnpm-workspace.yaml", ".npmrc"],
  supportFiles: [],
  installCommand: ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"],
  prodInstall: ProdInstall.Rewrite({ command: ["pnpm", "install", "--ignore-scripts", "--prod"] }),
  nodeModulesLayout: opts.layout,
  prependDepsRuns: (version) => [`corepack enable pnpm && corepack prepare pnpm@${version} --activate`]
})
