import { type PackageManager, ProdInstall, type YarnVariant } from "../PackageManager"

export interface YarnOptions {
  readonly variant: YarnVariant
}

export const yarn = (opts: YarnOptions): PackageManager => {
  const isBerry = opts.variant === "berry"

  return {
    kind: "Yarn",
    lockfileNames: ["yarn.lock"],
    auxFiles: isBerry ? [".yarnrc.yml", ".yarnrc"] : [".yarnrc"],
    // Berry has no --ignore-scripts flag; YARN_ENABLE_SCRIPTS=false is its
    // equivalent lifecycle-script suppression (every other PM disables scripts too).
    installCommand: isBerry
      ? ["YARN_ENABLE_SCRIPTS=false", "yarn", "install", "--immutable"]
      : ["yarn", "install", "--frozen-lockfile", "--ignore-scripts"],
    prodInstall: isBerry
      ? ProdInstall.Targeted({
        command: (target) => ["YARN_ENABLE_SCRIPTS=false", "yarn", "workspaces", "focus", "--production", target]
      })
      : ProdInstall.Rewrite({ command: ["yarn", "install", "--ignore-scripts", "--production"] }),
    nodeModulesLayout: "hoisted",
    prependDepsRuns: (version) =>
      version === ""
        ? []
        : [`corepack enable yarn && corepack prepare yarn@${version} --activate`]
  }
}
