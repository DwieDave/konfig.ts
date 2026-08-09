import { Console, Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { Command } from "effect/unstable/cli"
import { spawn } from "node:child_process"
import { REPO_ROOT, RepoScriptError, testPackageNames } from "../lib/repo"

const _run = (input: { readonly cwd: string; readonly script: string }) =>
  Effect.callback<void, RepoScriptError>((resume) => {
    const child = spawn("bun", ["run", "--cwd", input.cwd, input.script], {
      cwd: REPO_ROOT,
      stdio: "inherit"
    })
    child.on("error", (cause) => {
      resume(Effect.fail(new RepoScriptError({ message: `cannot spawn bun run --cwd ${input.cwd} ${input.script}`, cause })))
    })
    child.on("exit", (code) => {
      code === 0
        ? resume(Effect.void)
        : resume(Effect.fail(new RepoScriptError({ message: `${input.cwd}: '${input.script}' exited with code ${code}` })))
    })
    return Effect.sync(() => child.kill())
  })

// Vitest's github-actions reporter writes an unnamed "## Vitest Test Report"
// block per package run; prefixing a package heading in the step summary is
// the only way to attribute each block.
const _announce = (pkg: string) =>
  Effect.gen(function*() {
    const summaryFile = process.env.GITHUB_STEP_SUMMARY
    if (summaryFile === undefined) return
    const fs = yield* FileSystem
    const existing = yield* fs.readFileString(summaryFile).pipe(Effect.orElseSucceed(() => ""))
    yield* fs
      .writeFileString(summaryFile, `${existing}\n## 📦 @konfig.ts/${pkg}\n`)
      .pipe(Effect.mapError((cause) => new RepoScriptError({ message: `cannot append to ${summaryFile}`, cause })))
  })

export const testCommand = Command.make(
  "test",
  {},
  () =>
    Effect.gen(function*() {
      const path = yield* Path
      for (const pkg of yield* testPackageNames) {
        yield* _announce(pkg)
        yield* Console.log(`\n@konfig.ts/${pkg}`)
        yield* _run({ cwd: path.join("packages", pkg), script: "test" })
      }
    })
).pipe(
  Command.withDescription(
    "Run every test-carrying package's suite; on GitHub Actions each Vitest report is prefixed with its package name"
  )
)
