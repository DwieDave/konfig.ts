export const PACKAGE_MANAGERS = ["bun", "pnpm", "npm", "yarn"] as const
export type PackageManager = (typeof PACKAGE_MANAGERS)[number]
export const DEFAULT_PACKAGE_MANAGER: PackageManager = "bun"
export const STORAGE_KEY = "konfig-pm"

const CLI_PACKAGE = "@konfig.ts/cli"

export interface InstallSpec {
  readonly packages: string
  readonly dev: boolean
}

export const DEFAULT_SPEC: InstallSpec = { packages: CLI_PACKAGE, dev: true }

export const getInstallCommand = (pm: PackageManager, spec: InstallSpec = DEFAULT_SPEC): string => {
  const pkgs = spec.packages.trim().split(/\s+/).join(" ")
  if (pm === "bun") return `bun add ${spec.dev ? "-d " : ""}${pkgs}`
  if (pm === "pnpm") return `pnpm add ${spec.dev ? "-D " : ""}${pkgs}`
  if (pm === "yarn") return `yarn add ${spec.dev ? "-D " : ""}${pkgs}`
  return `npm i ${spec.dev ? "-D " : ""}${pkgs}`
}

const SET: ReadonlySet<string> = new Set(PACKAGE_MANAGERS)
export const isPackageManager = (value: string): value is PackageManager => SET.has(value)
