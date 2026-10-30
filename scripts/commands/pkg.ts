import { Effect } from "effect"
import { Argument, Command } from "effect/cli"
import { FileSystem } from "effect/FileSystem"
import { ChildProcess } from "effect/process"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { mapRepoError, REPO_ROOT, RepoScriptError } from "../lib/repo"

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
  const fs = yield* FileSystem
  const exists = (file: string) => fs.exists(file).pipe(Effect.orElseSucceed(() => false))
  const hasIndex = yield* exists("src/index.ts")

  return {
    entry: hasIndex ? "./src/index.ts" : "./src/main.ts",
    hasBuildTsconfig: yield* exists("tsconfig.build.json")
  } satisfies PkgLayout
})

const _spawn = (argv: Argv) =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner
      const [cmd = "", ...args] = argv

      const handle = yield* spawner.spawn(
        ChildProcess.make(cmd, args, { stdin: "inherit", stdout: "inherit", stderr: "inherit", extendEnv: true })
      )

      return Number(yield* handle.exitCode)
    })
  ).pipe(mapRepoError(`cannot spawn ${argv.join(" ")}`))

const _runStep = (argv: Argv) =>
  Effect.flatMap(
    _spawn(argv),
    (code) =>
      code === 0 ? Effect.void : Effect.fail(new RepoScriptError({ message: `${argv.join(" ")} exited with ${code}` }))
  )

export const pkgCommand = Command.make(
  "pkg",
  { script: Argument.Literals("script", PKG_SCRIPTS) },
  ({ script }) =>
    _layout.pipe(
      Effect.flatMap((layout) => Effect.forEach(pkgSteps({ script, layout }), _runStep, { discard: true }))
    )
).pipe(Command.withDescription("Run the shared per-package script (build, check, test, ...) in the cwd package"))
