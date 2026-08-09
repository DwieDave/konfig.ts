import { Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import { _resolveTarget } from "./bumpVersion"

describe("_resolveTarget", () => {
  it("passes an explicit x.y.z version through unchanged", () => {
    const result = Effect.runSync(_resolveTarget("1.2.3", "0.0.10"))
    expect(result).toBe("1.2.3")
  })

  it("accepts an explicit pre-release/build version too", () => {
    const result = Effect.runSync(_resolveTarget("1.2.3-rc.1+build.5", "0.0.10"))
    expect(result).toBe("1.2.3-rc.1+build.5")
  })

  it("major bump resets minor and patch to 0", () => {
    const result = Effect.runSync(_resolveTarget("major", "1.2.3"))
    expect(result).toBe("2.0.0")
  })

  it("minor bump resets patch to 0 and preserves major", () => {
    const result = Effect.runSync(_resolveTarget("minor", "1.2.3"))
    expect(result).toBe("1.3.0")
  })

  it("patch bump only increments patch", () => {
    const result = Effect.runSync(_resolveTarget("patch", "1.2.3"))
    expect(result).toBe("1.2.4")
  })

  it("fails on an arg that is neither semver nor major|minor|patch", () => {
    const exit = Effect.runSyncExit(_resolveTarget("bogus", "1.2.3"))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("fails when current version is not x.y.z (cannot bump)", () => {
    const exit = Effect.runSyncExit(_resolveTarget("patch", "not-a-version"))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
