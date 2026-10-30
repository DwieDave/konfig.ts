import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Option } from "effect"
import fc from "fast-check"
import { _checkK8sVersion, _decodeFlags, _toKubeconformVersion } from "./renderContextFlags"

const _version = fc.record({
  prefix: fc.constantFrom("", "v"),
  major: fc.nat({ max: 99 }),
  minor: fc.nat({ max: 99 }),
  patch: fc.option(fc.nat({ max: 99 }), { nil: undefined })
})

describe("_toKubeconformVersion", () => {
  it("expands major.minor to major.minor.0", () => {
    expect(_toKubeconformVersion("1.31")).toBe("1.31.0")
    expect(_toKubeconformVersion("v1.31.2")).toBe("1.31.2")
  })

  it("property: normalized value is major.minor.patch and keeps the numbers", () => {
    fc.assert(
      fc.property(_version, ({ prefix, major, minor, patch }) => {
        const raw = `${prefix}${major}.${minor}${patch === undefined ? "" : `.${patch}`}`
        expect(_toKubeconformVersion(raw)).toBe(`${major}.${minor}.${patch ?? 0}`)
      })
    )
  })
})

describe("_checkK8sVersion", () => {
  it.effect("accepts major.minor[.patch] with optional v", () =>
    Effect.gen(function*() {
      expect(yield* _checkK8sVersion("v1.31")).toBe("v1.31")
    }))

  it.each(["1", "latest", "1.x", ""])("rejects %j with InvalidK8sVersion", (value) => {
    const exit = Effect.runSyncExit(_checkK8sVersion(value))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(Exit.isFailure(exit) && String(exit.cause)).toContain("InvalidK8sVersion")
  })
})

describe("_decodeFlags", () => {
  it.effect("rejects a bad --k8s-version", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        _decodeFlags({ env: "prod", cluster: Option.none(), k8sVersion: Option.some("latest"), flag: Option.none() })
      )

      expect(Exit.isFailure(exit) && String(exit.cause)).toContain("InvalidK8sVersion")
    }))
})
