import { describe, expect, it } from "vitest"
import type { AstNode } from "../types.ts"
import { noParseCoercion } from "./no-parse-coercion.ts"
import { runVisitor } from "./test-support.ts"

describe("no-parse-coercion", () => {
  it("reports unsafeCoerce(YAML.parse(...))", () => {
    const node: AstNode = {
      type: "CallExpression",
      callee: { type: "Identifier", name: "unsafeCoerce" },
      arguments: [
        {
          type: "CallExpression",
          callee: {
            type: "MemberExpression",
            object: { type: "Identifier", name: "YAML" },
            property: { type: "Identifier", name: "parse" }
          },
          arguments: []
        }
      ]
    }
    const harness = runVisitor({ rule: noParseCoercion, event: "CallExpression", node })
    expect(harness.reports).toHaveLength(1)
    expect(harness.reports[0]?.message).toContain("Schema")
  })

  it("does not report unsafeCoerce of a non-parse value", () => {
    const node: AstNode = {
      type: "CallExpression",
      callee: { type: "Identifier", name: "unsafeCoerce" },
      arguments: [{ type: "Identifier", name: "value" }]
    }
    const harness = runVisitor({ rule: noParseCoercion, event: "CallExpression", node })
    expect(harness.reports).toHaveLength(0)
  })
})
