import { Data } from "effect"

export interface ImageRef {
  readonly image: string
  readonly tag: string
}

export type PmKind = "Bun" | "Npm" | "Pnpm" | "Yarn"

export type YarnVariant = "classic" | "berry"

export type NodeModulesLayout = "isolated" | "hoisted"

// Rewrite managers re-resolve against a root package.json trimmed to the
// closure, so they never use frozen/immutable/ci. Targeted managers install
// straight from the untouched lockfile, narrowed to the target workspace.
export type ProdInstall =
  | { readonly _tag: "Rewrite"; readonly command: ReadonlyArray<string> }
  | { readonly _tag: "Targeted"; readonly command: (target: string) => ReadonlyArray<string> }

export const ProdInstall = Data.taggedEnum<ProdInstall>()

export interface PackageManager {
  readonly kind: PmKind
  readonly lockfileNames: ReadonlyArray<string>
  readonly auxFiles: ReadonlyArray<string>
  readonly installCommand: ReadonlyArray<string>
  readonly prodInstall: ProdInstall
  readonly nodeModulesLayout: NodeModulesLayout
  readonly prependDepsRuns: (pmVersion: string) => ReadonlyArray<string>
}
