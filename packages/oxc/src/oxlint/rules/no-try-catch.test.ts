import { describe, expect, it } from "vitest"
import type { AstNode } from "../types.ts"
import { noTryCatch } from "./no-try-catch.ts"
import { runVisitor } from "./test-support.ts"

describe("no-try-catch", () => {
  it("reports a try statement", () => {
    const node: AstNode = { type: "TryStatement" }
    const harness = runVisitor({ rule: noTryCatch, event: "TryStatement", node })
    expect(harness.reports).toHaveLength(1)
  })
})
