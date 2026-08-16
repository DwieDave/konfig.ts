import { describe, expect, it } from "vitest"
import type { AstNode } from "../types.ts"
import { noAmbientNondeterminism } from "./no-ambient-nondeterminism.ts"
import { runVisitor } from "./test-support.ts"

describe("no-ambient-nondeterminism", () => {
  it("reports Math.random", () => {
    const node: AstNode = {
      type: "MemberExpression",
      object: { type: "Identifier", name: "Math" },
      property: { type: "Identifier", name: "random" }
    }
    const harness = runVisitor({ rule: noAmbientNondeterminism, event: "MemberExpression", node })
    expect(harness.reports).toHaveLength(1)
  })

  it("reports new Date()", () => {
    const node: AstNode = {
      type: "NewExpression",
      callee: { type: "Identifier", name: "Date" },
      arguments: []
    }
    const harness = runVisitor({ rule: noAmbientNondeterminism, event: "NewExpression", node })
    expect(harness.reports).toHaveLength(1)
  })

  it("does not report other members", () => {
    const node: AstNode = {
      type: "MemberExpression",
      object: { type: "Identifier", name: "Math" },
      property: { type: "Identifier", name: "max" }
    }
    const harness = runVisitor({ rule: noAmbientNondeterminism, event: "MemberExpression", node })
    expect(harness.reports).toHaveLength(0)
  })
})
