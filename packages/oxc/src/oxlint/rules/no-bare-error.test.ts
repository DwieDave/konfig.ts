import { describe, expect, it } from "vitest"
import type { AstNode } from "../types.ts"
import { noBareError } from "./no-bare-error.ts"
import { runVisitor } from "./test-support.ts"

describe("no-bare-error", () => {
  it("reports `new Error(...)` as a value", () => {
    const node: AstNode = {
      type: "NewExpression",
      callee: { type: "Identifier", name: "Error" }
    }
    const harness = runVisitor({ rule: noBareError, event: "NewExpression", node })
    expect(harness.reports).toHaveLength(1)
    expect(harness.reports[0]?.message).toContain("Data.TaggedError")
  })

  it("allows `throw new Error(...)`", () => {
    const node: AstNode = {
      type: "NewExpression",
      callee: { type: "Identifier", name: "Error" },
      parent: { type: "ThrowStatement" }
    }
    const harness = runVisitor({ rule: noBareError, event: "NewExpression", node })
    expect(harness.reports).toHaveLength(0)
  })

  it("allows a tagged error subclass", () => {
    const node: AstNode = {
      type: "NewExpression",
      callee: { type: "Identifier", name: "RenderError" }
    }
    const harness = runVisitor({ rule: noBareError, event: "NewExpression", node })
    expect(harness.reports).toHaveLength(0)
  })
})
