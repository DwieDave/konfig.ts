import { describe, expect, it } from "vitest"
import type { AstNode } from "../types.ts"
import { noSyncSchemaApis } from "./no-sync-schema-apis.ts"
import { runVisitor } from "./test-support.ts"

function _call(ns: string, api: string): AstNode {
  return {
    type: "CallExpression",
    callee: {
      type: "MemberExpression",
      object: { type: "Identifier", name: ns },
      property: { type: "Identifier", name: api }
    },
    arguments: []
  }
}

describe("no-sync-schema-apis", () => {
  it("reports Schema.decodeSync", () => {
    const harness = runVisitor({ rule: noSyncSchemaApis, event: "CallExpression", node: _call("Schema", "decodeSync") })
    expect(harness.reports).toHaveLength(1)
  })

  it("reports the S alias namespace", () => {
    const harness = runVisitor({ rule: noSyncSchemaApis, event: "CallExpression", node: _call("S", "parseSync") })
    expect(harness.reports).toHaveLength(1)
  })

  it("does not report the Effect/Either variant", () => {
    const harness = runVisitor({
      rule: noSyncSchemaApis,
      event: "CallExpression",
      node: _call("Schema", "decodeUnknown")
    })
    expect(harness.reports).toHaveLength(0)
  })

  it("does not report a sync-named method on an unrelated namespace", () => {
    const harness = runVisitor({ rule: noSyncSchemaApis, event: "CallExpression", node: _call("Other", "decodeSync") })
    expect(harness.reports).toHaveLength(0)
  })
})
