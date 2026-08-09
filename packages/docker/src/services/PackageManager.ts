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
  // Install command for the prod-deps stage. Must re-resolve against a
  // rewritten root package.json, so never uses frozen/immutable/ci mode.
  readonly prodInstallCommand: ReadonlyArray<string>
  readonly productionFlag: ReadonlyArray<string>
  readonly nodeModulesLayout: NodeModulesLayout
  readonly depsImage: (input: DepsImageInput) => ImageRef
  readonly prependDepsRuns: (pmVersion: string) => ReadonlyArray<string>
}
