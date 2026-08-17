import { describe, expect, it } from "vitest"
import { FAILURE_CASES, SNIPPETS, load } from "./catalog"

describe("catalog", () => {
  it("every failure case resolves its snippet and diagnostics", () => {
    for (const c of FAILURE_CASES) {
      const s = load(c.spec)
      expect(s.code.length, c.id).toBeGreaterThan(0)
      expect(s.diagnostics.length, c.id).toBe(c.spec.diagnostics?.length ?? 0)
      for (const d of s.diagnostics) {
        expect(d.colEnd, `${c.id} range`).toBeGreaterThan(d.colStart)
      }
      expect(s.code, `${c.id} keeps no expect-error lines`).not.toContain("@ts-expect-error")
    }
  })

  it("every prose snippet resolves", () => {
    for (const [key, spec] of Object.entries(SNIPPETS)) {
      const s = load(spec)
      expect(s.code.split("\n").length, key).toBeGreaterThan(1)
    }
  })
})
