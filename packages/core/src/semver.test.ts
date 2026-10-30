import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { compareSemver, parseSemver, type Semver } from "./semver"

const _ver = fc.record({
  major: fc.nat(30),
  minor: fc.nat(30),
  patch: fc.nat(30),
  prerelease: fc.array(fc.oneof(fc.nat(5).map(String), fc.constantFrom("rc", "alpha", "beta")), { maxLength: 3 })
})

const _show = (v: Semver): string =>
  `v${v.major}.${v.minor}.${v.patch}${v.prerelease.length > 0 ? `-${v.prerelease.join(".")}` : ""}`

describe("semver", () => {
  it("parse(show(v)) round-trips", () => {
    fc.assert(
      fc.property(_ver, (v) => {
        expect(parseSemver(_show(v))).toEqual(v)
      })
    )
  })

  it("compare is antisymmetric and reflexive", () => {
    fc.assert(
      fc.property(_ver, _ver, (a, b) => {
        expect(compareSemver({ a, b })).toBe(-compareSemver({ a: b, b: a }) || 0)
        expect(compareSemver({ a, b: a })).toBe(0)
      })
    )
  })

  it("a prerelease is below its release", () => {
    const rc = parseSemver("v3.16.0-rc.1")
    const rel = parseSemver("3.16.0")
    expect(rc !== null && rel !== null && compareSemver({ a: rc, b: rel })).toBe(-1)
  })

  it("accepts major.minor as major.minor.0 and rejects junk", () => {
    expect(parseSemver("3.16")).toEqual({ major: 3, minor: 16, patch: 0, prerelease: [] })
    expect(parseSemver("v3.16.1+gabc")?.patch).toBe(1)
    expect(parseSemver("latest")).toBeNull()
    expect(parseSemver("3")).toBeNull()
  })

  it("orders prerelease identifiers per semver", () => {
    const ids = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0"
    ]
    const parsed = ids.map((s) => parseSemver(s)).filter((v): v is Semver => v !== null)
    const sorted = [...parsed].sort((a, b) => compareSemver({ a, b }))
    expect(sorted).toEqual(parsed)
  })
})
