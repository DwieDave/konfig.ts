import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { _tail } from "./subprocess"

const arbLines = fc.array(fc.string({ maxLength: 100 }), { maxLength: 200 }).map((lines) => lines.join("\n"))

describe("_tail", () => {
  it("is bounded and starts at a line boundary", () => {
    fc.assert(
      fc.property(arbLines, (text) => {
        const tail = _tail(text)
        const boundary = tail === text || text.at(-tail.length - 1) === "\n"

        expect(tail.length).toBeLessThanOrEqual(2048)
        expect(text.endsWith(tail)).toBe(true)
        expect(boundary || !text.includes("\n")).toBe(true)
      })
    )
  })
})
