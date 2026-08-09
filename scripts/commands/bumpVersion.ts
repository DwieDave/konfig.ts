import { Console, Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { Argument, Command } from "effect/unstable/cli"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { packageDirs, readJson, REPO_ROOT, RepoScriptError } from "../lib/repo"

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

const _setVersion = (file: string, version: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const raw = yield* fs
      .readFileString(file)
      .pipe(Effect.mapError((cause) => new RepoScriptError({ message: `cannot read ${file}`, cause })))
    const next = raw.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`)
    if (next === raw) return false
    yield* fs
      .writeFileString(file, next)
      .pipe(Effect.mapError((cause) => new RepoScriptError({ message: `cannot write ${file}`, cause })))
    return true
  })

const _resolveTarget = (arg: string, current: string) =>
  Effect.gen(function*() {
    if (SEMVER_RE.test(arg)) return arg
    if (arg !== "major" && arg !== "minor" && arg !== "patch") {
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
    let [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (arg === "major") {
      major += 1
      minor = 0
      patch = 0
    } else if (arg === "minor") {
      minor += 1
      patch = 0
    } else {
      patch += 1
    }
    return `${major}.${minor}.${patch}`
  })

const _execFile = promisify(execFile)

export const bumpVersionCommand = Command.make(
  "bump-version",
  {
    target: Argument.string("target").pipe(
      Argument.withDescription("Explicit x.y.z version, or one of major | minor | patch")
    )
  },
  ({ target }) =>
    Effect.gen(function*() {
      const path = yield* Path

      const core = yield* readJson(path.join(REPO_ROOT, "packages", "core", "package.json"))
      const current = typeof core.version === "string" ? core.version : "0.0.0"
      const resolved = yield* _resolveTarget(target, current)
      yield* Console.log(`bumping ${current} → ${resolved}`)

      const rootBumped = yield* _setVersion(path.join(REPO_ROOT, "package.json"), resolved)
      if (rootBumped) yield* Console.log("  bumped package.json (root)")

      let published = 0
      for (const dir of yield* packageDirs) {
        const pkgJson = path.join(dir, "package.json")
        const pkg = yield* readJson(pkgJson)
        if (pkg.private === true) {
          yield* Console.log(`  skip (private): ${path.relative(REPO_ROOT, dir)}`)
          continue
        }
        const bumped = yield* _setVersion(pkgJson, resolved)
        if (bumped) {
          yield* Console.log(`  bumped ${path.relative(REPO_ROOT, dir)} → ${resolved}`)
          published += 1
        }
      }
      yield* Console.log(`bumped ${published} published packages + root`)

      // bun.lock must stay in sync or CI's --frozen-lockfile fails.
      yield* Effect.tryPromise({
        try: () => _execFile("bun", ["install"], { cwd: REPO_ROOT }),
        catch: (cause) => new RepoScriptError({ message: "'bun install' failed; run it manually to sync bun.lock", cause })
      }).pipe(
        Effect.catchTag("RepoScriptError", (e) => Console.warn(`warning: ${e.message}`))
      )

      yield* Console.log("\ndone. next:")
      yield* Console.log(`  git add -A && git commit -m "chore(release): bump published packages to ${resolved}"`)
      yield* Console.log(`  git tag -a v${resolved} -m "Release v${resolved}"`)
      yield* Console.log(`  git push origin main && git push origin v${resolved}`)
    })
).pipe(
  Command.withDescription(
    "Bump every published @konfig.ts/* package (and the private root) to a target version, in lockstep"
  )
)
