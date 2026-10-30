import { Console, Effect } from "effect"
import { Command } from "effect/cli"
import { ChildProcess } from "effect/process"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { mapRepoError, type PackageInfo, packageInfos, REPO_ROOT, RepoScriptError } from "../lib/repo"
import { topoOrder } from "../lib/topo"

const _runScript = (input: { readonly pkg: PackageInfo; readonly script: string }) =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner
      yield* Console.log(`\n> ${input.pkg.name} ${input.script}`)
      const handle = yield* spawner.spawn(
        ChildProcess.make("bun", ["run", "--cwd", input.pkg.dir, input.script], {
          cwd: REPO_ROOT,
          stdin: "ignore",
          stdout: "inherit",
          stderr: "inherit",
          extendEnv: true
        })
      )
      return Number(yield* handle.exitCode)
    })
  )

const _runAll = (script: string) =>
  Effect.gen(function*() {
    const pkgs = topoOrder(yield* packageInfos).filter((p) => p.scripts.has(script))
    for (const pkg of pkgs) {
      const code = yield* _runScript({ pkg, script }).pipe(
        mapRepoError(`cannot spawn ${script} for ${pkg.name}`)
      )
      if (code !== 0) return yield* new RepoScriptError({ message: `${script} failed in ${pkg.name}` })
    }
  })

const _makeCommand = (input: { readonly name: string; readonly script: string; readonly description: string }) =>
  Command.make(input.name, {}, () => _runAll(input.script)).pipe(Command.withDescription(input.description))

export const buildCommand = _makeCommand({
  name: "build",
  script: "build",
  description: "Run each package's build script in dependency order"
})

export const checkCommand = _makeCommand({
  name: "check",
  script: "check",
  description: "Run each package's check script in dependency order"
})

export const coverageCommand = _makeCommand({
  name: "coverage",
  script: "test:coverage",
  description: "Run each package's test:coverage script in dependency order"
})

export const packagesCommand = Command.make("packages", {}, () =>
  Effect.gen(function*() {
    const pkgs = topoOrder(yield* packageInfos).filter((p) => !p.isPrivate)
    yield* Effect.forEach(pkgs, (p) => Console.log(p.dir.split("/").pop()))
  })).pipe(Command.withDescription("Print publishable package directory names in dependency order"))
