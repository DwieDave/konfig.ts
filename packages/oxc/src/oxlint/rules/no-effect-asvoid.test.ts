import { describe, expect, it } from "vitest"
import type { AstNode } from "../types.ts"
import { noEffectAsVoid } from "./no-effect-asvoid.ts"
import { runVisitor } from "./test-support.ts"

describe("no-effect-asvoid", () => {
  it("reports Effect.asVoid", () => {
    const node: AstNode = {
      type: "MemberExpression",
      object: { type: "Identifier", name: "Effect" },
      property: { type: "Identifier", name: "asVoid" }
    }
    const harness = runVisitor({ rule: noEffectAsVoid, event: "MemberExpression", node })
    expect(harness.reports).toHaveLength(1)
  })

  it("does not report other Effect members", () => {
    const node: AstNode = {
      type: "MemberExpression",
      object: { type: "Identifier", name: "Effect" },
      property: { type: "Identifier", name: "map" }
    }
    const harness = runVisitor({ rule: noEffectAsVoid, event: "MemberExpression", node })
    expect(harness.reports).toHaveLength(0)
  })
})
