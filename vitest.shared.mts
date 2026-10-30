import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

interface PackageTestConfig {
  readonly aliases?: ReadonlyArray<string>
  readonly lines?: number
}

const _aliasEntry = (name: string) =>
  [`@konfig.ts/${name}`, fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))] as const

const _coverageFor = (lines: number) => ({
  provider: "v8" as const,
  include: ["src/**/*.ts"],
  exclude: ["src/**/*.test.ts", "src/.generated/**"],
  reporter: ["text-summary", "json-summary"],
  thresholds: { lines }
})

export const packageVitestConfig = (input: PackageTestConfig = {}) =>
  defineConfig({
    resolve: { alias: Object.fromEntries((input.aliases ?? []).map(_aliasEntry)) },
    test: {
      exclude: ["dist/**", "node_modules/**"],
      ...(input.lines === undefined ? {} : { coverage: _coverageFor(input.lines) })
    }
  })
