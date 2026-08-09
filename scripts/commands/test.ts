import { Console, Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { Command, Flag } from "effect/unstable/cli"
import { spawn } from "node:child_process"
import { availableParallelism } from "node:os"
import { REPO_ROOT, RepoScriptError, testPackageNames } from "../lib/repo"

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

const _run = (input: { readonly pkg: string; readonly summaryFile: string | undefined }) =>
  Effect.callback<_RunResult, RepoScriptError>((resume) => {
    const { args, cmd, cwd } = _spawnArgsFor(input.pkg)
    const child = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: input.summaryFile === undefined
        ? process.env
        : { ...process.env, GITHUB_STEP_SUMMARY: input.summaryFile }
    })
    const chunks: Array<Buffer> = []
    child.stdout.on("data", (chunk) => chunks.push(chunk))
    child.stderr.on("data", (chunk) => chunks.push(chunk))
    child.on("error", (cause) => {
      resume(Effect.fail(new RepoScriptError({ message: `cannot spawn tests for ${input.pkg}`, cause })))
    })
    child.on("close", (code) => {
      resume(Effect.succeed({ pkg: input.pkg, output: Buffer.concat(chunks).toString("utf8"), code: code ?? 1 }))
    })
    return Effect.sync(() => child.kill())
  })

// Each child gets its own GITHUB_STEP_SUMMARY file; stitched under its package heading afterwards.
const _stitchSummary = (results: ReadonlyArray<_RunResult & { readonly summaryFile: string | undefined }>) =>
  Effect.gen(function*() {
    const summaryFile = process.env.GITHUB_STEP_SUMMARY
    if (summaryFile === undefined) return
    const fs = yield* FileSystem
    let out = ""
    for (const r of results) {
      const block = r.summaryFile === undefined
        ? ""
        : yield* fs.readFileString(r.summaryFile).pipe(Effect.orElseSucceed(() => ""))
      out += `\n## 📦 ${r.pkg === _SCRIPTS_PSEUDO_PACKAGE ? r.pkg : `@konfig.ts/${r.pkg}`}\n${block}`
    }
    const existing = yield* fs.readFileString(summaryFile).pipe(Effect.orElseSucceed(() => ""))
    yield* fs
      .writeFileString(summaryFile, existing + out)
      .pipe(Effect.mapError((cause) => new RepoScriptError({ message: `cannot append to ${summaryFile}`, cause })))
  })

export const testCommand = Command.make(
  "test",
  {
    concurrency: Flag.integer("concurrency").pipe(
      Flag.withDefault(Math.max(2, Math.floor(availableParallelism() / 2))),
      Flag.withDescription("How many package suites run at once (each already parallelizes internally)")
    )
  },
  ({ concurrency }) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const packages = [...(yield* testPackageNames), _SCRIPTS_PSEUDO_PACKAGE]
      const inCi = process.env.GITHUB_STEP_SUMMARY !== undefined

      const tmpDir = inCi
        ? yield* fs
          .makeTempDirectoryScoped({ prefix: "konfig-test-summaries-" })
          .pipe(Effect.mapError((cause) => new RepoScriptError({ message: "cannot create summary temp dir", cause })))
        : undefined

      const results = yield* Effect.all(
        packages.map((pkg) =>
          Effect.gen(function*() {
            const summaryFile = tmpDir === undefined ? undefined : path.join(tmpDir, `${pkg}.md`)
            const result = yield* _run({ pkg, summaryFile })
            const label = pkg === _SCRIPTS_PSEUDO_PACKAGE ? pkg : `@konfig.ts/${pkg}`
            yield* Console.log(`\n📦 ${label}\n${result.output}`)
            return { ...result, summaryFile }
          })
        ),
        { concurrency }
      )

      yield* _stitchSummary(results)

      const failed = results.filter((r) => r.code !== 0)
      if (failed.length > 0) {
        return yield* new RepoScriptError({
          message: `test suites failed: ${failed.map((r) => r.pkg).join(", ")}`
        })
      }
    }).pipe(Effect.scoped)
).pipe(
  Command.withDescription(
    "Run every test-carrying package's suite concurrently; on GitHub Actions each Vitest report lands under its package heading"
  )
)
