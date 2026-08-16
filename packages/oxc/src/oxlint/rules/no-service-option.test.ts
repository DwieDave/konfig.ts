import { describe, expect, it } from "vitest"
import type { AstNode } from "../types.ts"
import { noServiceOption } from "./no-service-option.ts"
import { runVisitor } from "./test-support.ts"

describe("no-service-option", () => {
  it("reports Effect.serviceOption", () => {
    const node: AstNode = {
      type: "MemberExpression",
      object: { type: "Identifier", name: "Effect" },
      property: { type: "Identifier", name: "serviceOption" }
    }
    const harness = runVisitor({ rule: noServiceOption, event: "MemberExpression", node })
    expect(harness.reports).toHaveLength(1)
  })

  it("does not report other Effect members", () => {
    const node: AstNode = {
      type: "MemberExpression",
      object: { type: "Identifier", name: "Effect" },
      property: { type: "Identifier", name: "service" }
    }
    const harness = runVisitor({ rule: noServiceOption, event: "MemberExpression", node })
    expect(harness.reports).toHaveLength(0)
  })
})
