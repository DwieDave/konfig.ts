import { describe, expect, it } from "vitest"
import type { AstNode, Comment } from "../types.ts"
import { noComments } from "./no-comments.ts"
import { createHarness, runVisitor } from "./test-support.ts"

const program: AstNode = { type: "Program" }

describe("no-comments", () => {
  it("reports a non-JSDoc block comment", () => {
    const comments: Comment[] = [{ type: "Block", value: " not jsdoc " }]
    const harness = createHarness({ comments })
    runVisitor({ rule: noComments, event: "Program", node: program, harness: harness })
    expect(harness.reports).toHaveLength(1)
    expect(harness.reports[0]?.message).toContain("Non-JSDoc block comments")
  })

  it("allows JSDoc block comments", () => {
    const comments: Comment[] = [{ type: "Block", value: "* a jsdoc comment " }]
    const harness = createHarness({ comments })
    runVisitor({ rule: noComments, event: "Program", node: program, harness: harness })
    expect(harness.reports).toHaveLength(0)
  })

  it("reports a line comment over the max length", () => {
    const comments: Comment[] = [{ type: "Line", value: "x".repeat(151) }]
    const harness = createHarness({ comments })
    runVisitor({ rule: noComments, event: "Program", node: program, harness: harness })
    expect(harness.reports).toHaveLength(1)
    expect(harness.reports[0]?.message).toContain("exceeds 150 chars")
  })

  it("allows a short line comment", () => {
    const comments: Comment[] = [{ type: "Line", value: "short" }]
    const harness = createHarness({ comments })
    runVisitor({ rule: noComments, event: "Program", node: program, harness: harness })
    expect(harness.reports).toHaveLength(0)
  })

  it("exempts directive comments and konfig:WHY comments", () => {
    const comments: Comment[] = [
      { type: "Line", value: " eslint-disable-next-line" },
      { type: "Line", value: " konfig: WHY " + "x".repeat(200) },
      { type: "Block", value: " @ts-expect-error some non-jsdoc reason" }
    ]
    const harness = createHarness({ comments })
    runVisitor({ rule: noComments, event: "Program", node: program, harness: harness })
    expect(harness.reports).toHaveLength(0)
  })
})
