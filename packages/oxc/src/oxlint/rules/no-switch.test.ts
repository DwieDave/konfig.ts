import { describe, expect, it } from "vitest"
import type { AstNode } from "../types.ts"
import { noSwitch } from "./no-switch.ts"
import { runVisitor } from "./test-support.ts"

describe("no-switch", () => {
  it("reports a switch statement", () => {
    const node: AstNode = { type: "SwitchStatement", discriminant: { type: "Identifier", name: "x" }, cases: [] }
    const harness = runVisitor({ rule: noSwitch, event: "SwitchStatement", node: node })
    expect(harness.reports).toHaveLength(1)
    expect(harness.reports[0]?.message).toContain("Match")
  })
})
