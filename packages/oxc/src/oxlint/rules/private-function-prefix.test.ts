import { describe, expect, it } from "vitest"
import type { AstNode } from "../types.ts"
import { privateFunctionPrefix } from "./private-function-prefix.ts"
import { runVisitor } from "./test-support.ts"

describe("private-function-prefix", () => {
  it("reports a top-level non-exported function without a leading underscore", () => {
    const program: AstNode = { type: "Program" }
    const fn: AstNode = { type: "FunctionDeclaration", id: { type: "Identifier", name: "foo" }, parent: program }
    const harness = runVisitor({ rule: privateFunctionPrefix, event: "FunctionDeclaration", node: fn })
    expect(harness.reports).toHaveLength(1)
    expect(harness.reports[0]?.message).toContain("_foo")
  })

  it("does not report a top-level non-exported function already prefixed with _", () => {
    const program: AstNode = { type: "Program" }
    const fn: AstNode = { type: "FunctionDeclaration", id: { type: "Identifier", name: "_foo" }, parent: program }
    const harness = runVisitor({ rule: privateFunctionPrefix, event: "FunctionDeclaration", node: fn })
    expect(harness.reports).toHaveLength(0)
  })

  it("exempts an exported top-level function", () => {
    const program: AstNode = { type: "Program" }
    const exportDecl: AstNode = { type: "ExportNamedDeclaration", parent: program }
    const fn: AstNode = {
      type: "FunctionDeclaration",
      id: { type: "Identifier", name: "foo" },
      parent: exportDecl
    }
    const harness = runVisitor({ rule: privateFunctionPrefix, event: "FunctionDeclaration", node: fn })
    expect(harness.reports).toHaveLength(0)
  })

  it("exempts a nested (non-top-level) function", () => {
    const program: AstNode = { type: "Program" }
    const outerFn: AstNode = { type: "FunctionDeclaration", parent: program }
    const block: AstNode = { type: "BlockStatement", parent: outerFn }
    const fn: AstNode = { type: "FunctionDeclaration", id: { type: "Identifier", name: "foo" }, parent: block }
    const harness = runVisitor({ rule: privateFunctionPrefix, event: "FunctionDeclaration", node: fn })
    expect(harness.reports).toHaveLength(0)
  })

  it("reports a top-level non-exported arrow-function variable without a leading underscore", () => {
    const program: AstNode = { type: "Program" }
    const decl: AstNode = {
      type: "VariableDeclaration",
      parent: program,
      declarations: [
        {
          type: "VariableDeclarator",
          id: { type: "Identifier", name: "bar" },
          init: { type: "ArrowFunctionExpression" }
        }
      ]
    }
    const harness = runVisitor({ rule: privateFunctionPrefix, event: "VariableDeclaration", node: decl })
    expect(harness.reports).toHaveLength(1)
    expect(harness.reports[0]?.message).toContain("_bar")
  })

  it("does not report a top-level variable that is not a function", () => {
    const program: AstNode = { type: "Program" }
    const decl: AstNode = {
      type: "VariableDeclaration",
      parent: program,
      declarations: [
        {
          type: "VariableDeclarator",
          id: { type: "Identifier", name: "bar" },
          init: { type: "NumericLiteral", value: 1 }
        }
      ]
    }
    const harness = runVisitor({ rule: privateFunctionPrefix, event: "VariableDeclaration", node: decl })
    expect(harness.reports).toHaveLength(0)
  })
})
