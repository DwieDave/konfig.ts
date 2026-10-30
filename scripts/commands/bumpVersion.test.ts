import { Console, Effect, Exit } from "effect"
import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { type PackageJson, REPO_ROOT } from "../lib/repo"
import { makeStubLayer } from "../lib/stubFs"
import { _bumpPackage, _increment, resolveTarget } from "./bumpVersion"

describe("resolveTarget", () => {
  it("passes an explicit x.y.z version through unchanged", () => {
    const result = Effect.runSync(resolveTarget({ arg: "1.2.3", current: "0.0.10" }))
    expect(result).toBe("1.2.3")
  })

  it("accepts an explicit pre-release/build version too", () => {
    const result = Effect.runSync(resolveTarget({ arg: "1.2.3-rc.1+build.5", current: "0.0.10" }))
    expect(result).toBe("1.2.3-rc.1+build.5")
  })

  it("major bump resets minor and patch to 0", () => {
    const result = Effect.runSync(resolveTarget({ arg: "major", current: "1.2.3" }))
    expect(result).toBe("2.0.0")
  })

  it("minor bump resets patch to 0 and preserves major", () => {
    const result = Effect.runSync(resolveTarget({ arg: "minor", current: "1.2.3" }))
    expect(result).toBe("1.3.0")
  })

  it("patch bump only increments patch", () => {
    const result = Effect.runSync(resolveTarget({ arg: "patch", current: "1.2.3" }))
    expect(result).toBe("1.2.4")
  })

  it("fails on an arg that is neither semver nor major|minor|patch", () => {
    const exit = Effect.runSyncExit(resolveTarget({ arg: "bogus", current: "1.2.3" }))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("fails when current version is not x.y.z (cannot bump)", () => {
    const exit = Effect.runSyncExit(resolveTarget({ arg: "patch", current: "not-a-version" }))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe("_increment", () => {
  const arith = {
    major: (p: readonly [number, number, number]) => `${p[0] + 1}.0.0`,
    minor: (p: readonly [number, number, number]) => `${p[0]}.${p[1] + 1}.0`,
    patch: (p: readonly [number, number, number]) => `${p[0]}.${p[1]}.${p[2] + 1}`
  }

  it("matches the major/minor/patch arithmetic and resolveTarget", () => {
    fc.assert(fc.property(
      fc.constantFrom("major", "minor", "patch" as const),
      fc.tuple(fc.nat(1000), fc.nat(1000), fc.nat(1000)),
      (kind, parts) => {
        expect(_increment({ kind, parts })).toBe(arith[kind](parts))
        const current = parts.join(".")
        expect(Effect.runSync(resolveTarget({ arg: kind, current }))).toBe(arith[kind](parts))
      }
    ))
  })
})

describe("_bumpPackage", () => {
  const run = (pkg: PackageJson) => {
    const files = new Map([[`${REPO_ROOT}packages/a/package.json`, JSON.stringify(pkg)]])
    const logs: Array<string> = []
    const logger: Console.Console = { ...console, log: (m: string) => void logs.push(m) }

    const outcome = Effect.runSync(
      _bumpPackage({ dir: `${REPO_ROOT}packages/a`, version: "2.0.0" }).pipe(
        Effect.provide(makeStubLayer(files)),
        Effect.provideService(Console.Console, logger)
      )
    )

    return { outcome, logs, files }
  }

  it("skips private packages", () => {
    const r = run({ name: "a", private: true, version: "1.0.0" })
    expect(r.outcome).toBe("skipped")
    expect(r.logs[0]).toContain("skip (private)")
  })
  it("bumps the version and logs it", () => {
    const r = run({ name: "a", version: "1.0.0" })
    expect(r.outcome).toBe("bumped")
    expect([...r.files.values()][0]).toContain(`"version":"2.0.0"`)
    expect(r.logs[0]).toContain("→ 2.0.0")
  })
  it("reports unchanged when already at target", () => {
    const r = run({ name: "a", version: "2.0.0" })
    expect(r.outcome).toBe("unchanged")
    expect(r.logs[0]).toContain("already at target")
  })
})
