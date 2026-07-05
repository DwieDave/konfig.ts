import type { PackageManager } from "../PackageManager"

export type YarnVariant = "classic" | "berry"

export interface YarnOptions {
  readonly variant: YarnVariant
}

/**
 * Yarn — both Yarn classic (1.x) and Yarn berry (≥ 2.x). The two
 * variants share a lockfile name (`yarn.lock`) but differ in install
 * semantics:
 *
 *  - **classic** uses `yarn install --frozen-lockfile` with the
 *    flat-or-hoisted node_modules layout.
 *  - **berry** uses `yarn install --immutable` and is auto-set when
 *    `.yarnrc.yml` is present. Workspaces are resolved from
 *    `package.json#workspaces` (same as classic) but the lockfile
 *    format and registry behavior differ. We do not (yet) emit
 *    workspace-focused-install steps for berry (`yarn workspaces focus`)
 *    — this is the surface a 1.x release will need to harden.
 */
export const yarn = (opts: YarnOptions): PackageManager => {
  const isBerry = opts.variant === "berry"
  return {
    _tag: "Yarn",
    lockfileNames: ["yarn.lock"],
    auxFiles: isBerry ? [".yarnrc.yml", ".yarnrc"] : [".yarnrc"],
    installCommand: isBerry
      ? ["yarn", "install", "--immutable"]
      : ["yarn", "install", "--frozen-lockfile", "--ignore-scripts"],
    prodInstallCommand: isBerry
      ? ["yarn", "install"]
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
