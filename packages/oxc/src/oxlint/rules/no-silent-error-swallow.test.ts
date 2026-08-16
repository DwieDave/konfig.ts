import { describe, expect, it } from "vitest"
import type { AstNode } from "../types.ts"
import { noSilentErrorSwallow } from "./no-silent-error-swallow.ts"
import { runVisitor } from "./test-support.ts"

describe("no-silent-error-swallow", () => {
  it("reports Effect.catchAll(() => Effect.void)", () => {
    const node: AstNode = {
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        object: { type: "Identifier", name: "Effect" },
        property: { type: "Identifier", name: "catchAll" }
      },
      arguments: [
        {
          type: "MemberExpression",
          object: { type: "Identifier", name: "Effect" },
          property: { type: "Identifier", name: "void" }
        }
      ]
    }
    const harness = runVisitor({ rule: noSilentErrorSwallow, event: "CallExpression", node })
    expect(harness.reports).toHaveLength(1)
  })

  it("does not report catchAll with a meaningful recovery", () => {
    const node: AstNode = {
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        object: { type: "Identifier", name: "Effect" },
        property: { type: "Identifier", name: "catchAll" }
      },
      arguments: [{ type: "Identifier", name: "recover" }]
    }
    const harness = runVisitor({ rule: noSilentErrorSwallow, event: "CallExpression", node })
    expect(harness.reports).toHaveLength(0)
  })
})
