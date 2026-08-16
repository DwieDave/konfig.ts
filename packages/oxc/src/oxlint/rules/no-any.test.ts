import { describe, expect, it } from "vitest"
import type { AstNode } from "../types.ts"
import { noAny } from "./no-any.ts"
import { runVisitor } from "./test-support.ts"

describe("no-any", () => {
  it("reports a value-level `any`", () => {
    const node: AstNode = { type: "TSAnyKeyword" }
    const harness = runVisitor({ rule: noAny, event: "TSAnyKeyword", node })
    expect(harness.reports).toHaveLength(1)
    expect(harness.reports[0]?.message).toContain("any")
  })

  it("allows `any` inside a type alias (erasure type)", () => {
    const alias: AstNode = { type: "TSTypeAliasDeclaration" }
    const node: AstNode = { type: "TSAnyKeyword", parent: alias }
    const harness = runVisitor({ rule: noAny, event: "TSAnyKeyword", node })
    expect(harness.reports).toHaveLength(0)
  })

  it("allows `any` inside an assertion (handled by no-banned-type-assertions)", () => {
    const cast: AstNode = { type: "TSAsExpression" }
    const node: AstNode = { type: "TSAnyKeyword", parent: cast }
    const harness = runVisitor({ rule: noAny, event: "TSAnyKeyword", node })
    expect(harness.reports).toHaveLength(0)
  })
})
