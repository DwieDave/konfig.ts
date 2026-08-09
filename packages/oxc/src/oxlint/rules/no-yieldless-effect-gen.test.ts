import { describe, expect, it } from "vitest"
import type { AstNode } from "../types.ts"
import { noYieldlessEffectGen } from "./no-yieldless-effect-gen.ts"
import { runVisitor } from "./test-support.ts"

function _effectGenCall(fn: AstNode): AstNode {
  return {
    type: "CallExpression",
    callee: {
      type: "MemberExpression",
      object: { type: "Identifier", name: "Effect" },
      property: { type: "Identifier", name: "gen" }
    },
    arguments: [fn]
  }
}

function _genFn(body: AstNode): AstNode {
  return { type: "FunctionExpression", generator: true, params: [], body }
}

describe("no-yieldless-effect-gen", () => {
  it("reports a generator body with no yield*", () => {
    const call = _effectGenCall(_genFn({ type: "BlockStatement", body: [] }))
    const harness = runVisitor({ rule: noYieldlessEffectGen, event: "CallExpression", node: call })
    expect(harness.reports).toHaveLength(1)
  })

  it("does not report when the body yields directly", () => {
    const body: AstNode = {
      type: "BlockStatement",
      body: [{ type: "ExpressionStatement", expression: { type: "YieldExpression" } }]
    }
    const call = _effectGenCall(_genFn(body))
    const harness = runVisitor({ rule: noYieldlessEffectGen, event: "CallExpression", node: call })
    expect(harness.reports).toHaveLength(0)
  })

  it("regression: reports an outer yieldless Effect.gen even when it wraps a yielding nested Effect.gen", () => {
    // Effect.gen(function* () {
    //   const inner = Effect.gen(function* () { yield* something })
    // })
    const innerBody: AstNode = {
      type: "BlockStatement",
      body: [{ type: "ExpressionStatement", expression: { type: "YieldExpression" } }]
    }
    const innerCall = _effectGenCall(_genFn(innerBody))
    const outerBody: AstNode = {
      type: "BlockStatement",
      body: [
        {
          type: "VariableDeclaration",
          declarations: [
            { type: "VariableDeclarator", id: { type: "Identifier", name: "inner" }, init: innerCall }
          ]
        }
      ]
    }
    const outerCall = _effectGenCall(_genFn(outerBody))
    const harness = runVisitor({ rule: noYieldlessEffectGen, event: "CallExpression", node: outerCall })
    expect(harness.reports).toHaveLength(1)
  })

  it("ignores non-Effect.gen calls", () => {
    const call: AstNode = {
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        object: { type: "Identifier", name: "Other" },
        property: { type: "Identifier", name: "gen" }
      },
      arguments: [_genFn({ type: "BlockStatement", body: [] })]
    }
    const harness = runVisitor({ rule: noYieldlessEffectGen, event: "CallExpression", node: call })
    expect(harness.reports).toHaveLength(0)
  })

  it("ignores arrow functions and non-generator functions", () => {
    const arrowCall = _effectGenCall({
      type: "ArrowFunctionExpression",
      generator: true,
      params: [],
      body: {
        type: "BlockStatement",
        body: []
      }
    })
    const nonGenCall = _effectGenCall({
      type: "FunctionExpression",
      generator: false,
      params: [],
      body: { type: "BlockStatement", body: [] }
    })
    const harness1 = runVisitor({ rule: noYieldlessEffectGen, event: "CallExpression", node: arrowCall })
    const harness2 = runVisitor({ rule: noYieldlessEffectGen, event: "CallExpression", node: nonGenCall })
    expect(harness1.reports).toHaveLength(0)
    expect(harness2.reports).toHaveLength(0)
  })
})
