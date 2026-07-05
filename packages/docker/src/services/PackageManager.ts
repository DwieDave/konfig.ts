export interface ImageRef {
  readonly image: string
  readonly tag: string
}

export interface DepsImageInput {
  readonly runtimeImage: ImageRef
  readonly pmVersion: string
}

export type NodeModulesLayout = "isolated" | "hoisted"

export interface PackageManager {
  readonly _tag: "Bun" | "Npm" | "Pnpm" | "Yarn"
  readonly lockfileNames: ReadonlyArray<string>
  readonly auxFiles: ReadonlyArray<string>
  readonly installCommand: ReadonlyArray<string>
  /**
   * Install command for the `prod-deps` stage. Unlike
   * {@link installCommand} this MUST re-resolve against a rewritten root
   * `package.json` (the stage restricts `workspaces` to the closure and
   * deletes root `devDependencies`), so it never uses a
   * frozen/immutable/`ci` mode: those validate the untouched lockfile
   * against the trimmed manifest and fail.
   *   bun  → ["bun", "install", "--ignore-scripts"]
   *   npm  → ["npm", "install", "--ignore-scripts"]   (NOT `npm ci`)
   *   pnpm → ["pnpm", "install", "--ignore-scripts"]  (no --frozen-lockfile)
   *   yarn → ["yarn", "install", "--ignore-scripts"]  (classic, no --frozen-lockfile)
   *          ["yarn", "install"]                        (berry, no --immutable)
   */
  readonly prodInstallCommand: ReadonlyArray<string>
  /**
   * Argv tokens to append to {@link installCommand} to skip
   * `devDependencies`. Used by the `prod-deps` stage emitted when
   * `RunnerSpec.production === true`.
   *   bun  → ["--production"]
   *   npm  → ["--omit=dev"]
   *   pnpm → ["--prod"]
   */
  readonly productionFlag: ReadonlyArray<string>
  readonly nodeModulesLayout: NodeModulesLayout
  readonly depsImage: (input: DepsImageInput) => ImageRef
  /**
   * RUN lines to prepend before {@link installCommand}. Currently only pnpm
   * uses it to enable corepack with the requested version.
   */
  readonly prependDepsRuns: (pmVersion: string) => ReadonlyArray<string>
}
