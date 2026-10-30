import { runProcessExit } from "@konfig.ts/core"
import { Console, Effect, Match } from "effect"
import { Argument, Command } from "effect/cli"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { ChildProcess } from "effect/process"
import { mapRepoError, packageDirs, readJson, REPO_ROOT, RepoScriptError } from "../lib/repo"

const INSTALL_WARNING = "warning: 'bun install' failed; run it manually to sync bun.lock"

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

const _setVersion = (input: { readonly file: string; readonly version: string }) =>
  Effect.gen(function*() {
    const { file, version } = input
    const fs = yield* FileSystem

    const raw = yield* fs
      .readFileString(file)
      .pipe(mapRepoError(`cannot read ${file}`))

    const next = raw.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`)

    if (next === raw) return false
    yield* fs
      .writeFileString(file, next)
      .pipe(mapRepoError(`cannot write ${file}`))

    return true
  })

export const _increment = (input: {
  readonly kind: "major" | "minor" | "patch"
  readonly parts: readonly [number, number, number]
}) =>
  Match.value(input.kind).pipe(
    Match.when("major", () => `${input.parts[0] + 1}.0.0`),
    Match.when("minor", () => `${input.parts[0]}.${input.parts[1] + 1}.0`),
    Match.when("patch", () => `${input.parts[0]}.${input.parts[1]}.${input.parts[2] + 1}`),
    Match.exhaustive
  )

const _isBumpKind = (arg: string): arg is "major" | "minor" | "patch" =>
  arg === "major" || arg === "minor" || arg === "patch"

export const resolveTarget = (input: { readonly arg: string; readonly current: string }) =>
  Effect.gen(function*() {
    const { arg, current } = input

    if (SEMVER_RE.test(arg)) return arg

    if (!_isBumpKind(arg)) {
      return yield* new RepoScriptError({
        message: `expected an explicit x.y.z version or one of major|minor|patch, got "${arg}"`
      })
    }

    const m = SEMVER_RE.exec(current)

    if (m === null) {
      return yield* new RepoScriptError({
        message: `current version "${current}" is not x.y.z; cannot ${arg}-bump`
      })
    }

    return _increment({ kind: arg, parts: [Number(m[1]), Number(m[2]), Number(m[3])] })
  })

export const _bumpPackage = (input: { readonly dir: string; readonly version: string }) =>
  Effect.gen(function*() {
    const path = yield* Path
    const pkgJson = path.join(input.dir, "package.json")
    const rel = path.relative(REPO_ROOT, input.dir)
    const pkg = yield* readJson(pkgJson)

    if (pkg.private === true) {
      yield* Console.log(`  skip (private): ${rel}`)

      return "skipped" as const
    }

    const bumped = yield* _setVersion({ file: pkgJson, version: input.version })
    yield* Console.log(bumped ? `  bumped ${rel} → ${input.version}` : `  already at target: ${rel}`)

    return bumped ? ("bumped" as const) : ("unchanged" as const)
  })

const _bumpAll = (version: string) =>
  Effect.gen(function*() {
    const outcomes = yield* Effect.forEach(yield* packageDirs, (dir) => _bumpPackage({ dir, version }))
    const published = outcomes.filter((o) => o === "bumped").length
    const alreadyAtTarget = outcomes.filter((o) => o === "unchanged").length
    yield* Console.log(`bumped ${published} published packages + root (${alreadyAtTarget} already at target)`)
  })

const _syncLockfile = runProcessExit({ command: ChildProcess.make("bun", ["install"], { cwd: REPO_ROOT }) }).pipe(
  Effect.catchTags({
    ProcessError: () => Console.warn(INSTALL_WARNING),
    ProcessTimeout: () => Console.warn(INSTALL_WARNING)
  })
)

const _printNext = (version: string) =>
  Effect.gen(function*() {
    yield* Console.log("\ndone. next:")
    yield* Console.log(`  git add -A && git commit -m "chore(release): bump published packages to ${version}"`)
    yield* Console.log(`  git tag -a v${version} -m "Release v${version}"`)
    yield* Console.log(`  git push origin main && git push origin v${version}`)
  })

const _runBump = (target: string) =>
  Effect.gen(function*() {
    const path = yield* Path
    const core = yield* readJson(path.join(REPO_ROOT, "packages", "core", "package.json"))
    const current = core.version ?? "0.0.0"
    const resolved = yield* resolveTarget({ arg: target, current })
    yield* Console.log(`bumping ${current} → ${resolved}`)
    const rootBumped = yield* _setVersion({ file: path.join(REPO_ROOT, "package.json"), version: resolved })

    if (rootBumped) yield* Console.log("  bumped package.json (root)")
    yield* _bumpAll(resolved)
    yield* _syncLockfile
    yield* _printNext(resolved)
  })

export const bumpVersionCommand = Command.make(
  "bump-version",
  {
    target: Argument.String("target").pipe(
      Argument.withDescription("Explicit x.y.z version, or one of major | minor | patch")
    )
  },
  ({ target }) => _runBump(target)
).pipe(
  Command.withDescription(
    "Bump every published @konfig.ts/* package (and the private root) to a target version, in lockstep"
  )
)
