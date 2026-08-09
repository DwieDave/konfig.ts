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

const _run = (input: { readonly pkg: string; readonly summaryFile: string | undefined }) =>
  Effect.callback<_RunResult, RepoScriptError>((resume) => {
    const child = spawn("bun", ["run", "--cwd", `packages/${input.pkg}`, "test"], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: input.summaryFile === undefined
        ? process.env
        : { ...process.env, GITHUB_STEP_SUMMARY: input.summaryFile }
    })
    const chunks: Array<Buffer> = []
    child.stdout.on("data", (chunk) => chunks.push(chunk))
    child.stderr.on("data", (chunk) => chunks.push(chunk))
    child.on("error", (cause) => {
      resume(Effect.fail(new RepoScriptError({ message: `cannot spawn tests for packages/${input.pkg}`, cause })))
    })
    child.on("close", (code) => {
      resume(Effect.succeed({ pkg: input.pkg, output: Buffer.concat(chunks).toString("utf8"), code: code ?? 1 }))
    })
    return Effect.sync(() => child.kill())
  })

// Vitest's github-actions reporter writes an unnamed "## Vitest Test Report"
// block per package run. With packages running concurrently, each child gets
// its own summary file (via a GITHUB_STEP_SUMMARY override) and the blocks are
// stitched into the real summary afterwards, each under its package heading —
// parallel execution with deterministic, correctly-labelled output.
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
      out += `\n## 📦 @konfig.ts/${r.pkg}\n${block}`
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
      const packages = yield* testPackageNames
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
            yield* Console.log(`\n📦 @konfig.ts/${pkg}\n${result.output}`)
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
