import { isCallExpression, isIdentifier, isMemberExpression } from "../types.ts"
import type { AstNode, Rule } from "../types.ts"

const SYNC_APIS = new Set([
  "decodeSync",
  "decodeUnknownSync",
  "decodeEitherSync",
  "decodeUnknownEitherSync",
  "encodeSync",
  "encodeUnknownSync",
  "encodeEitherSync",
  "encodeUnknownEitherSync",
  "validateSync",
  "validateUnknownSync",
  "parseSync",
  "parseUnknownSync",
  "isSync",
  "asserts"
])

const SCHEMA_NAMESPACES = new Set(["Schema", "S"])

function _isSchemaSyncCallee(callee: AstNode): { ns: string; api: string } | null {
  if (!isMemberExpression(callee)) return null
  const object = callee.object
  const property = callee.property
  if (!isIdentifier(object) || !isIdentifier(property)) return null
  const ns = object.name
  const api = property.name
  if (!SCHEMA_NAMESPACES.has(ns)) return null
  if (!SYNC_APIS.has(api)) return null
  return { ns, api }
}

export const noSyncSchemaApis: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Forbid synchronous Effect Schema APIs (they throw); prefer the Effect/Either variants."
    }
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isCallExpression(node)) return
        const callee = node.callee
        const hit = _isSchemaSyncCallee(callee)
        if (!hit) return
        context.report({
          node: callee,
          message: `\`${hit.ns}.${hit.api}\` throws on failure. Use the Effect or Either variant instead.`
        })
      }
    }
  }
}
