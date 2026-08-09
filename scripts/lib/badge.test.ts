import { describe, expect, it } from "vitest"
import { renderBadge } from "./badge"

describe("renderBadge", () => {
  it("embeds label, value and color in the rendered SVG", () => {
    const svg = renderBadge({ label: "tests", value: "42", color: "#007ec6" })
    expect(svg).toContain(`aria-label="tests: 42"`)
    expect(svg).toContain(`>tests<`)
    expect(svg).toContain(`>42<`)
    expect(svg).toContain(`fill="#007ec6"`)
  })

  it("sizes the two segments from label/value text width, longer text -> wider segment", () => {
    const short = renderBadge({ label: "x", value: "y", color: "#000" })
    const long = renderBadge({ label: "line coverage", value: "100.0%", color: "#000" })
    const widthOf = (svg: string) => Number(/width="(\d+)"/.exec(svg)?.[1])
    expect(widthOf(long)).toBeGreaterThan(widthOf(short))
  })

  it("is deterministic for the same input", () => {
    const a = renderBadge({ label: "effect", value: "4.0.0", color: "#312e81" })
    const b = renderBadge({ label: "effect", value: "4.0.0", color: "#312e81" })
    expect(a).toBe(b)
  })
})
