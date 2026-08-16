import { describe, expect, it } from "vitest"
import type { AstNode } from "../types.ts"
import { noBannedTypeAssertions } from "./no-banned-type-assertions.ts"
import { runVisitor } from "./test-support.ts"

describe("no-banned-type-assertions", () => {
  it("reports `as any`", () => {
    const node: AstNode = {
      type: "TSAsExpression",
      expression: { type: "Identifier", name: "x" },
      typeAnnotation: { type: "TSAnyKeyword" }
    }
    const harness = runVisitor({ rule: noBannedTypeAssertions, event: "TSAsExpression", node: node })
    expect(harness.reports).toHaveLength(1)
    expect(harness.reports[0]?.message).toContain("as any")
  })

  it("reports `as unknown` and `as never`", () => {
    for (const ann of ["TSUnknownKeyword", "TSNeverKeyword"]) {
      const node: AstNode = {
        type: "TSAsExpression",
        expression: { type: "Identifier", name: "x" },
        typeAnnotation: { type: ann }
      }
      const harness = runVisitor({ rule: noBannedTypeAssertions, event: "TSAsExpression", node: node })
      expect(harness.reports).toHaveLength(1)
    }
  })

  it("reports double assertions", () => {
    const node: AstNode = {
      type: "TSAsExpression",
      expression: {
        type: "TSAsExpression",
        expression: { type: "Identifier", name: "x" },
        typeAnnotation: { type: "TSStringKeyword" }
      },
      typeAnnotation: { type: "TSNumberKeyword" }
    }
    const harness = runVisitor({ rule: noBannedTypeAssertions, event: "TSAsExpression", node: node })
    expect(harness.reports).toHaveLength(1)
    expect(harness.reports[0]?.message).toContain("Double type assertions")
  })

  it("does not report an ordinary single assertion to a non-banned type", () => {
    const node: AstNode = {
      type: "TSAsExpression",
      expression: { type: "Identifier", name: "x" },
      typeAnnotation: { type: "TSStringKeyword" }
    }
    const harness = runVisitor({ rule: noBannedTypeAssertions, event: "TSAsExpression", node: node })
    expect(harness.reports).toHaveLength(0)
  })

  it("reports nested `any` (e.g. `as any[]`)", () => {
    const node: AstNode = {
      type: "TSAsExpression",
      expression: { type: "Identifier", name: "x" },
      typeAnnotation: { type: "TSArrayType", elementType: { type: "TSAnyKeyword" } }
    }
    const harness = runVisitor({ rule: noBannedTypeAssertions, event: "TSAsExpression", node: node })
    expect(harness.reports).toHaveLength(1)
    expect(harness.reports[0]?.message).toContain("as any")
  })

  it("does not report nested `unknown` (e.g. `Record<string, unknown>`)", () => {
    const node: AstNode = {
      type: "TSAsExpression",
      expression: { type: "Identifier", name: "x" },
      typeAnnotation: {
        type: "TSTypeReference",
        typeName: { type: "Identifier", name: "Record" },
        typeArguments: {
          type: "TSTypeParameterInstantiation",
          params: [{ type: "TSStringKeyword" }, { type: "TSUnknownKeyword" }]
        }
      }
    }
    const harness = runVisitor({ rule: noBannedTypeAssertions, event: "TSAsExpression", node: node })
    expect(harness.reports).toHaveLength(0)
  })
})
