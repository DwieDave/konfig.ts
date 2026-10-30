import { Console, Effect } from "effect"
import { Command } from "effect/cli"
import { Path } from "effect/Path"
import { type PackageInfo, packageInfos, REPO_ROOT, RepoScriptError } from "../lib/repo"
import { spawnInherit } from "../lib/spawn"
import { topoOrder } from "../lib/topo"

export interface ScriptRun {
  readonly name: string
  readonly argv: ReadonlyArray<string>
  readonly cwd: string
}

export const SCRIPTS_RUN: ScriptRun = {
  name: "scripts vitest run",
  argv: ["bunx", "vitest", "run"],
  cwd: `${REPO_ROOT}/scripts`
}

export const planScript = (input: { readonly pkgs: ReadonlyArray<PackageInfo>; readonly script: string }) =>
  topoOrder(input.pkgs)
    .filter((p) => p.scripts.has(input.script))
    .map((pkg): ScriptRun => ({
      name: `${pkg.name} ${input.script}`,
      argv: ["bun", "run", "--cwd", pkg.dir, input.script],
      cwd: REPO_ROOT
    }))

export const planCoverage = (pkgs: ReadonlyArray<PackageInfo>) => [
  ...planScript({ pkgs, script: "test:coverage" }),
  SCRIPTS_RUN
]

const _execute = (run: ScriptRun) =>
  Console.log(`\n> ${run.name}`).pipe(
    Effect.andThen(spawnInherit({ argv: run.argv, cwd: run.cwd })),
    Effect.filterOrFail((code) => code === 0, () => new RepoScriptError({ message: `${run.name} failed` }))
  )

const _runAll = (plan: (pkgs: ReadonlyArray<PackageInfo>) => ReadonlyArray<ScriptRun>) =>
  packageInfos.pipe(Effect.flatMap((pkgs) => Effect.forEach(plan(pkgs), _execute, { discard: true })))

const _makeCommand = (input: {
  readonly name: string
  readonly plan: (pkgs: ReadonlyArray<PackageInfo>) => ReadonlyArray<ScriptRun>
  readonly description: string
}) => Command.make(input.name, {}, () => _runAll(input.plan)).pipe(Command.withDescription(input.description))

export const buildCommand = _makeCommand({
  name: "build",
  plan: (pkgs) => planScript({ pkgs, script: "build" }),
  description: "Run each package's build script in dependency order"
})

export const checkCommand = _makeCommand({
  name: "check",
  plan: (pkgs) => planScript({ pkgs, script: "check" }),
  description: "Run each package's check script in dependency order"
})

export const coverageCommand = _makeCommand({
  name: "coverage",
  plan: planCoverage,
  description: "Run each package's test:coverage script in dependency order, then the scripts tests"
})

export const packagesCommand = Command.make("packages", {}, () =>
  Effect.gen(function*() {
    const path = yield* Path
    const pkgs = topoOrder(yield* packageInfos).filter((p) => !p.isPrivate)
    yield* Effect.forEach(pkgs, (p) => Console.log(path.basename(p.dir)))
  })).pipe(Command.withDescription("Print publishable package directory names in dependency order"))
