export interface ImageRef {
  readonly image: string
  readonly tag: string
}

export type PmKind = "Bun" | "Npm" | "Pnpm" | "Yarn"
export type YarnVariant = "classic" | "berry"
export type NodeModulesLayout = "isolated" | "hoisted"

export interface PackageManager {
  readonly _tag: PmKind
  readonly lockfileNames: ReadonlyArray<string>
  readonly auxFiles: ReadonlyArray<string>
  readonly installCommand: ReadonlyArray<string>
  // Install command for the prod-deps stage. Bun installs frozen from the
  // untouched lockfile (narrowed via --filter); the others re-resolve
  // against a rewritten root package.json, so never use frozen/immutable/ci.
  readonly prodInstallCommand: ReadonlyArray<string>
  readonly productionFlag: ReadonlyArray<string>
  readonly nodeModulesLayout: NodeModulesLayout
  readonly prependDepsRuns: (pmVersion: string) => ReadonlyArray<string>
}
