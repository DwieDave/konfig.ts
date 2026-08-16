import { describe, expect, it } from "vitest"
import type { AstNode } from "../types.ts"
import { noTypeofObject } from "./no-typeof-object.ts"
import { runVisitor } from "./test-support.ts"

describe("no-typeof-object", () => {
  it('reports typeof x === "object"', () => {
    const node: AstNode = {
      type: "BinaryExpression",
      operator: "===",
      left: { type: "UnaryExpression", operator: "typeof" },
      right: { type: "Literal", value: "object" }
    }
    const harness = runVisitor({ rule: noTypeofObject, event: "BinaryExpression", node })
    expect(harness.reports).toHaveLength(1)
  })

  it('does not report typeof x === "string"', () => {
    const node: AstNode = {
      type: "BinaryExpression",
      operator: "===",
      left: { type: "UnaryExpression", operator: "typeof" },
      right: { type: "Literal", value: "string" }
    }
    const harness = runVisitor({ rule: noTypeofObject, event: "BinaryExpression", node })
    expect(harness.reports).toHaveLength(0)
  })
})
