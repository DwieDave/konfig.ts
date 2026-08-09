import type { PackageManager } from "../PackageManager"

type YarnVariant = "classic" | "berry"

export interface YarnOptions {
  readonly variant: YarnVariant
}

export const yarn = (opts: YarnOptions): PackageManager => {
  const isBerry = opts.variant === "berry"
  return {
    _tag: "Yarn",
    lockfileNames: ["yarn.lock"],
    auxFiles: isBerry ? [".yarnrc.yml", ".yarnrc"] : [".yarnrc"],
    // Berry has no --ignore-scripts flag; YARN_ENABLE_SCRIPTS=false is its
    // equivalent lifecycle-script suppression (every other PM disables scripts too).
    installCommand: isBerry
      ? ["YARN_ENABLE_SCRIPTS=false", "yarn", "install", "--immutable"]
      : ["yarn", "install", "--frozen-lockfile", "--ignore-scripts"],
    prodInstallCommand: isBerry
      ? ["YARN_ENABLE_SCRIPTS=false", "yarn", "install"]
      : ["yarn", "install", "--ignore-scripts"],
    productionFlag: isBerry ? [] : ["--production"],
    nodeModulesLayout: "hoisted",
    depsImage: ({ runtimeImage }) => runtimeImage,
    prependDepsRuns: (version) =>
      version === ""
        ? []
        : [`corepack enable yarn && corepack prepare yarn@${version} --activate`]
  }
}
