import { describe, expect, it } from "vitest"
import type { AstNode } from "../types.ts"
import { noRecordStringUndefined } from "./no-record-string-undefined.ts"
import { runVisitor } from "./test-support.ts"

function _recordType(params: readonly AstNode[]): AstNode {
  return {
    type: "TSTypeReference",
    typeName: { type: "Identifier", name: "Record" },
    typeArguments: { params }
  }
}

describe("no-record-string-undefined", () => {
  it("reports Record<string, undefined>", () => {
    const node = _recordType([{ type: "TSStringKeyword" }, { type: "TSUndefinedKeyword" }])
    const harness = runVisitor({ rule: noRecordStringUndefined, event: "TSTypeReference", node: node })
    expect(harness.reports).toHaveLength(1)
  })

  it("does not report Record<string, unknown>", () => {
    const node = _recordType([{ type: "TSStringKeyword" }, { type: "TSUnknownKeyword" }])
    const harness = runVisitor({ rule: noRecordStringUndefined, event: "TSTypeReference", node: node })
    expect(harness.reports).toHaveLength(0)
  })

  it("does not report other type references", () => {
    const node: AstNode = {
      type: "TSTypeReference",
      typeName: { type: "Identifier", name: "Array" },
      typeArguments: { params: [{ type: "TSStringKeyword" }] }
    }
    const harness = runVisitor({ rule: noRecordStringUndefined, event: "TSTypeReference", node: node })
    expect(harness.reports).toHaveLength(0)
  })

  it("does not report Record with a wrong arity", () => {
    const node = _recordType([{ type: "TSStringKeyword" }])
    const harness = runVisitor({ rule: noRecordStringUndefined, event: "TSTypeReference", node: node })
    expect(harness.reports).toHaveLength(0)
  })
})
