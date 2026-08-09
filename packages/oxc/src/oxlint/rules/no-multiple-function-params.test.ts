import { describe, expect, it } from "vitest"
import type { AstNode } from "../types.ts"
import { noMultipleFunctionParams } from "./no-multiple-function-params.ts"
import { createHarness, runVisitor } from "./test-support.ts"

const params: readonly AstNode[] = [
  { type: "Identifier", name: "a" },
  { type: "Identifier", name: "b" }
]

describe("no-multiple-function-params", () => {
  it("reports an exported multi-arg function (default scope)", () => {
    const program: AstNode = { type: "Program" }
    const exportDecl: AstNode = { type: "ExportNamedDeclaration", parent: program }
    const fn: AstNode = { type: "FunctionDeclaration", params, parent: exportDecl }
    const harness = runVisitor({ rule: noMultipleFunctionParams, event: "FunctionDeclaration", node: fn })
    expect(harness.reports).toHaveLength(1)
  })

  it("does not report a non-exported multi-arg function (default scope)", () => {
    const program: AstNode = { type: "Program" }
    const fn: AstNode = { type: "FunctionDeclaration", params, parent: program }
    const harness = runVisitor({ rule: noMultipleFunctionParams, event: "FunctionDeclaration", node: fn })
    expect(harness.reports).toHaveLength(0)
  })

  it("reports a non-exported multi-arg function under scope: all", () => {
    const program: AstNode = { type: "Program" }
    const fn: AstNode = { type: "FunctionDeclaration", params, parent: program }
    const harness = createHarness({ options: [{ scope: "all" }] })
    runVisitor({ rule: noMultipleFunctionParams, event: "FunctionDeclaration", node: fn, harness: harness })
    expect(harness.reports).toHaveLength(1)
  })

  it("does not report a single-param function", () => {
    const program: AstNode = { type: "Program" }
    const exportDecl: AstNode = { type: "ExportNamedDeclaration", parent: program }
    const fn: AstNode = { type: "FunctionDeclaration", params: [params[0]], parent: exportDecl }
    const harness = runVisitor({ rule: noMultipleFunctionParams, event: "FunctionDeclaration", node: fn })
    expect(harness.reports).toHaveLength(0)
  })

  it("exempts an inline callback passed to a call expression", () => {
    const program: AstNode = { type: "Program" }
    const call: AstNode = { type: "CallExpression", parent: program }
    const fn: AstNode = { type: "FunctionExpression", params, parent: call }
    const harness = createHarness({ options: [{ scope: "all" }] })
    runVisitor({ rule: noMultipleFunctionParams, event: "FunctionExpression", node: fn, harness: harness })
    expect(harness.reports).toHaveLength(0)
  })

  it("exempts a multi-arg function nested inside another function, even under scope: all", () => {
    const program: AstNode = { type: "Program" }
    const outerFn: AstNode = { type: "FunctionDeclaration", parent: program }
    const innerFn: AstNode = { type: "FunctionDeclaration", params, parent: outerFn }
    const harness = createHarness({ options: [{ scope: "all" }] })
    runVisitor({ rule: noMultipleFunctionParams, event: "FunctionDeclaration", node: innerFn, harness: harness })
    expect(harness.reports).toHaveLength(0)
  })
})
