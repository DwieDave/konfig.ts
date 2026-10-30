import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { hasWildcard, segmentMatches } from "./workspaceGlob"

const name = fc.string({ minLength: 0, maxLength: 8, unit: fc.constantFrom("a", "b", "-", ".", "1", "+", "(") })

describe("segmentMatches", () => {
  it("a literal segment matches only itself", () => {
    fc.assert(
      fc.property(name, name, (a, b) => {
        expect(segmentMatches({ segment: a, name: b })).toBe(a === b)
      })
    )
  })

  it("prefix-* matches exactly the names with that prefix", () => {
    fc.assert(
      fc.property(name, name, (prefix, n) => {
        expect(segmentMatches({ segment: `${prefix}*`, name: n })).toBe(n.startsWith(prefix))
      })
    )
  })

  it("*-suffix matches exactly the names with that suffix", () => {
    fc.assert(
      fc.property(name, name, (suffix, n) => {
        expect(segmentMatches({ segment: `*${suffix}`, name: n })).toBe(n.endsWith(suffix))
      })
    )
  })

  it("lone * matches everything", () => {
    fc.assert(fc.property(name, (n) => segmentMatches({ segment: "*", name: n })))
  })

  it("hasWildcard detects * and ?", () => {
    expect(hasWildcard("web-*")).toBe(true)
    expect(hasWildcard("web")).toBe(false)
  })
})
