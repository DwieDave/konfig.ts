import { existsOrFalse } from "@konfig.ts/core"
import { Effect } from "effect"
import { Argument, Command } from "effect/cli"
import { mapRepoError, REPO_ROOT, RepoScriptError } from "../lib/repo"
import { spawnInherit } from "../lib/spawn"

export const PKG_SCRIPTS = ["build", "check", "test", "lint", "test:coverage", "prepack", "postpack"] as const

export type PkgScript = (typeof PKG_SCRIPTS)[number]

export type Argv = ReadonlyArray<string>

export interface PkgLayout {
  readonly entry: string
  readonly hasBuildTsconfig: boolean
}

const _cli = `${REPO_ROOT}scripts/cli.ts`

const _buildSteps = (layout: PkgLayout): ReadonlyArray<Argv> => [
  ["bunx", "tsdown", layout.entry, "--format=esm", "--target=node22", "--sourcemap", "--clean", "--no-dts"],
  layout.hasBuildTsconfig ? ["bunx", "tsc", "-p", "tsconfig.build.json"] : ["chmod", "+x", "dist/main.mjs"]
]

const _VITEST_COVERAGE: Argv = [
  "bunx",
  "vitest",
  "run",
  "--coverage",
  "--reporter=default",
  "--reporter=json",
  "--outputFile=./coverage/test-results.json"
]

export const pkgSteps = (input: { readonly script: PkgScript; readonly layout: PkgLayout }): ReadonlyArray<Argv> => {
  const table: Record<PkgScript, ReadonlyArray<Argv>> = {
    build: _buildSteps(input.layout),
    check: [["bunx", "tsc", "-p", "tsconfig.check.json", "--noEmit"]],
    test: [["bunx", "vitest", "run"]],
    lint: [["bunx", "oxlint"]],
    "test:coverage": [_VITEST_COVERAGE],
    prepack: [["bun", _cli, "prepack-exports", "strip"]],
    postpack: [["bun", _cli, "prepack-exports", "restore"]]
  }

  return table[input.script]
}

const _layout = Effect.gen(function*() {
  const hasIndex = yield* existsOrFalse("src/index.ts")

  return {
    entry: hasIndex ? "./src/index.ts" : "./src/main.ts",
    hasBuildTsconfig: yield* existsOrFalse("tsconfig.build.json")
  } satisfies PkgLayout
})

const _runStep = (argv: Argv) =>
  Effect.flatMap(
    spawnInherit({ argv }),
    (code) =>
      code === 0 ? Effect.void : Effect.fail(new RepoScriptError({ message: `${argv.join(" ")} exited with ${code}` }))
  )

export const pkgCommand = Command.make(
  "pkg",
  { script: Argument.Literals("script", PKG_SCRIPTS) },
  ({ script }) =>
    _layout.pipe(
      mapRepoError("cannot inspect package layout"),
      Effect.flatMap((layout) => Effect.forEach(pkgSteps({ script, layout }), _runStep, { discard: true }))
    )
).pipe(Command.withDescription("Run the shared per-package script (build, check, test, ...) in the cwd package"))
