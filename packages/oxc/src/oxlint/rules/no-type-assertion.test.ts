import { describe, expect, it } from "vitest"
import type { AstNode } from "../types.ts"
import { noTypeAssertion } from "./no-type-assertion.ts"
import { runVisitor } from "./test-support.ts"

describe("no-type-assertion", () => {
  it("reports a plain `as` assertion", () => {
    const node: AstNode = {
      type: "TSAsExpression",
      expression: { type: "Identifier", name: "x" },
      typeAnnotation: { type: "TSStringKeyword" }
    }
    const harness = runVisitor({ rule: noTypeAssertion, event: "TSAsExpression", node: node })
    expect(harness.reports).toHaveLength(1)
  })

  it("does not report `as const`", () => {
    const node: AstNode = {
      type: "TSAsExpression",
      expression: { type: "Identifier", name: "x" },
      typeAnnotation: { type: "TSTypeReference", typeName: { type: "Identifier", name: "const" } }
    }
    const harness = runVisitor({ rule: noTypeAssertion, event: "TSAsExpression", node: node })
    expect(harness.reports).toHaveLength(0)
  })

  it("reports a TSTypeAssertion (`<T>x` style)", () => {
    const node: AstNode = {
      type: "TSTypeAssertion",
      expression: { type: "Identifier", name: "x" },
      typeAnnotation: { type: "TSStringKeyword" }
    }
    const harness = runVisitor({ rule: noTypeAssertion, event: "TSTypeAssertion", node: node })
    expect(harness.reports).toHaveLength(1)
  })
})
