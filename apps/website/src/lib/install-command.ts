export const PACKAGE_MANAGERS = ["bun", "pnpm", "npm", "yarn"] as const
export type PackageManager = (typeof PACKAGE_MANAGERS)[number]
export const DEFAULT_PACKAGE_MANAGER: PackageManager = "bun"

const PACKAGE = "@konfig.ts/cli"

export const getInstallCommand = (pm: PackageManager): string => {
  if (pm === "bun") return `bun add -d ${PACKAGE}`
  if (pm === "pnpm") return `pnpm add -D ${PACKAGE}`
  if (pm === "yarn") return `yarn add -D ${PACKAGE}`
  return `npm i -D ${PACKAGE}`
}

const SET: ReadonlySet<string> = new Set(PACKAGE_MANAGERS)
export const isPackageManager = (value: string): value is PackageManager => SET.has(value)
