import { describe, expect, it } from "vitest"
import type { AstNode } from "../types.ts"
import { noNodeChildProcess } from "./no-node-child-process.ts"
import { runVisitor } from "./test-support.ts"

describe("no-node-child-process", () => {
  it("reports importing node:child_process", () => {
    const node: AstNode = {
      type: "ImportDeclaration",
      source: { type: "Literal", value: "node:child_process" }
    }
    const harness = runVisitor({ rule: noNodeChildProcess, event: "ImportDeclaration", node })
    expect(harness.reports).toHaveLength(1)
    expect(harness.reports[0]?.message).toContain("node:child_process")
  })

  it("does not report other node builtins", () => {
    const node: AstNode = {
      type: "ImportDeclaration",
      source: { type: "Literal", value: "node:fs" }
    }
    const harness = runVisitor({ rule: noNodeChildProcess, event: "ImportDeclaration", node })
    expect(harness.reports).toHaveLength(0)
  })
})
