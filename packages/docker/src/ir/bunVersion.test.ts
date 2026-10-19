import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { supportsFilteredInstall } from "./bunVersion"

const atLeast12 = (major: number, minor: number): boolean => major > 1 || (major === 1 && minor >= 2)

describe("supportsFilteredInstall", () => {
  it("is true exactly when major.minor >= 1.2, for any patch/suffix", () =>
    fc.assert(
      fc.property(
        fc.nat(5),
        fc.nat(20),
        fc.option(fc.nat(99), { nil: undefined }),
        fc.constantFrom("", "-alpine", "-canary"),
        (major, minor, patch, suffix) => {
          const v = `${major}.${minor}${patch === undefined ? "" : `.${patch}`}${suffix}`
          expect(supportsFilteredInstall(v)).toBe(atLeast12(major, minor))
        }
      )
    ))

  it("treats a bare major as major.0", () =>
    fc.assert(
      fc.property(fc.nat(5), (major) => {
        expect(supportsFilteredInstall(`${major}`)).toBe(major >= 2)
      })
    ))

  it("lets unparseable versions through", () =>
    fc.assert(
      fc.property(fc.constantFrom("latest", "canary", "", "x.y"), (v) => {
        expect(supportsFilteredInstall(v)).toBe(true)
      })
    ))
})
