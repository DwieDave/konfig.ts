import { Config, Console, Effect, Option, Stream } from "effect"
import { Command, Flag } from "effect/cli"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import type { PlatformError } from "effect/PlatformError"
import { ChildProcess } from "effect/process"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { availableParallelism } from "node:os"
import { mapRepoError, REPO_ROOT, RepoScriptError, testPackageNames } from "../lib/repo"

interface _RunResult {
  readonly pkg: string
  readonly output: string
  readonly code: number
}

// "scripts" isn't a workspace package (no package.json/test script of its own), so its
// pure helpers are covered by a standalone vitest config run directly via bunx instead.
const _SCRIPTS_PSEUDO_PACKAGE = "scripts"

const _spawnArgsFor = (pkg: string) =>
  pkg === _SCRIPTS_PSEUDO_PACKAGE
    ? { cmd: "bunx", args: ["vitest", "run"], cwd: `${REPO_ROOT}/scripts` }
    : { cmd: "bun", args: ["run", "--cwd", `packages/${pkg}`, "test"], cwd: REPO_ROOT }

const _collect = (stream: Stream.Stream<Uint8Array, PlatformError>) => Stream.mkString(Stream.decodeText(stream))

const _commandFor = (input: { readonly pkg: string; readonly summaryFile: string | undefined }) => {
  const { args, cmd, cwd } = _spawnArgsFor(input.pkg)

  return ChildProcess.make(cmd, args, {
    cwd,
    stdin: "ignore",
    extendEnv: true,
    env: input.summaryFile === undefined ? {} : { GITHUB_STEP_SUMMARY: input.summaryFile }
  })
}

const _run = (input: { readonly pkg: string; readonly summaryFile: string | undefined }) =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner
      const handle = yield* spawner.spawn(_commandFor(input))

      const [code, out, err] = yield* Effect.all(
        [handle.exitCode, _collect(handle.stdout), _collect(handle.stderr)],
        { concurrency: "unbounded" }
      )

      return { pkg: input.pkg, output: out + err, code: Number(code) } satisfies _RunResult
    })
  ).pipe(
    mapRepoError(`cannot spawn tests for ${input.pkg}`)
  )

const _labelFor = (pkg: string) => pkg === _SCRIPTS_PSEUDO_PACKAGE ? pkg : `@konfig.ts/${pkg}`

const _summaryEnv = Config.option(Config.String("GITHUB_STEP_SUMMARY"))

const _readOrEmpty = (file: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem

    return yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""))
  })

const _block = (r: _RunResult & { readonly summaryFile: string | undefined }) =>
  Effect.map(
    r.summaryFile === undefined ? Effect.succeed("") : _readOrEmpty(r.summaryFile),
    (block) => `\n## 📦 ${_labelFor(r.pkg)}\n${block}`
  )

// Each child gets its own GITHUB_STEP_SUMMARY file; stitched under its package heading afterwards.
const _stitchSummary = (results: ReadonlyArray<_RunResult & { readonly summaryFile: string | undefined }>) =>
  Effect.gen(function*() {
    const summaryFile = yield* _summaryEnv

    if (Option.isNone(summaryFile)) return
    const fs = yield* FileSystem
    const blocks = yield* Effect.forEach(results, _block)
    const existing = yield* _readOrEmpty(summaryFile.value)
    yield* fs
      .writeFileString(summaryFile.value, existing + blocks.join(""))
      .pipe(mapRepoError(`cannot append to ${summaryFile.value}`))
  })

const _runOne = (input: { readonly pkg: string; readonly tmpDir: string | undefined }) =>
  Effect.gen(function*() {
    const path = yield* Path
    const { pkg, tmpDir } = input
    const summaryFile = tmpDir === undefined ? undefined : path.join(tmpDir, `${pkg}.md`)
    const result = yield* _run({ pkg, summaryFile })
    yield* Console.log(`\n📦 ${_labelFor(pkg)}\n${result.output}`)

    return { ...result, summaryFile }
  })

export const summaryTmpDir = Effect.gen(function*() {
  if (Option.isNone(yield* _summaryEnv)) return undefined
  const fs = yield* FileSystem

  return yield* fs
    .makeTempDirectoryScoped({ prefix: "konfig-test-summaries-" })
    .pipe(mapRepoError("cannot create summary temp dir"))
})

const _runAll = (concurrency: number) =>
  Effect.gen(function*() {
    const packages = [...(yield* testPackageNames), _SCRIPTS_PSEUDO_PACKAGE]
    const tmpDir = yield* summaryTmpDir
    const results = yield* Effect.forEach(packages, (pkg) => _runOne({ pkg, tmpDir }), { concurrency })
    yield* _stitchSummary(results)
    const failed = results.filter((r) => r.code !== 0)

    if (failed.length > 0) {
      return yield* new RepoScriptError({
        message: `test suites failed: ${failed.map((r) => r.pkg).join(", ")}`
      })
    }
  }).pipe(Effect.scoped)

export const testCommand = Command.make(
  "test",
  {
    concurrency: Flag.Int("concurrency").pipe(
      Flag.withDefault(Math.max(2, Math.floor(availableParallelism() / 2))),
      Flag.withDescription("How many package suites run at once (each already parallelizes internally)")
    )
  },
  ({ concurrency }) => _runAll(concurrency)
).pipe(
  Command.withDescription(
    "Run every test-carrying package's suite concurrently; on GitHub Actions each Vitest report lands under its package heading"
  )
)
