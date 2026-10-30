import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

interface PackageTestConfig {
  readonly aliases?: ReadonlyArray<string>
  readonly lines?: number
}

const _aliasEntry = (name: string) =>
  [`@konfig.ts/${name}`, fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))] as const

const _testingAlias = (names: ReadonlyArray<string>) =>
  names.includes("core")
    ? [["@konfig.ts/core/testing", fileURLToPath(new URL("./packages/core/src/testing.ts", import.meta.url))] as const]
    : []

const _coverageFor = (lines: number) => ({
  provider: "v8" as const,
  include: ["src/**/*.ts"],
  exclude: ["src/**/*.test.ts", "src/.generated/**"],
  reporter: ["text-summary", "json-summary"],
  thresholds: { lines }
})

const _testFor = (lines: number | undefined) => {
  const base = { exclude: ["dist/**", "node_modules/**"] }

  return lines === undefined ? base : { ...base, coverage: _coverageFor(lines) }
}

export const packageVitestConfig = (input: PackageTestConfig = {}) =>
  defineConfig({
    resolve: { alias: Object.fromEntries([..._testingAlias(input.aliases ?? []), ...(input.aliases ?? []).map(_aliasEntry)]) },
    test: _testFor(input.lines)
  })
