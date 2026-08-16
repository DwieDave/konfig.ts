import { isTSTypeCast } from "../types.ts"
import type { AstNode, Rule } from "../types.ts"

const TOP_LEVEL_BANNED = new Set(["TSAnyKeyword", "TSUnknownKeyword", "TSNeverKeyword"])
const SKIP_KEYS = new Set(["type", "loc", "parent", "range", "start", "end"])

function _isNode(value: unknown): value is AstNode {
  if (typeof value !== "object" || value === null) return false
  return typeof (value as AstNode).type === "string"
}

function _keywordName(type: string): string {
  return type.replace(/^TS|Keyword$/g, "").toLowerCase()
}

// `any` is banned anywhere; nested `unknown`/`never` stay legal (Record<string, unknown>, Effect<A, E, never>).
function _findNestedAny(node: AstNode): string | null {
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue
    const value = node[key]
    const children = Array.isArray(value) ? value : [value]
    for (const child of children) {
      if (!_isNode(child)) continue
      if (child.type === "TSAnyKeyword") return "any"
      const found = _findNestedAny(child)
      if (found) return found
    }
  }
  return null
}

function _bannedTargetKind(node: AstNode): string | null {
  if (!isTSTypeCast(node)) return null
  const ann = node.typeAnnotation
  if (TOP_LEVEL_BANNED.has(ann.type)) return _keywordName(ann.type)
  return _findNestedAny(ann)
}

function _isDoubleAssertion(node: AstNode): boolean {
  if (!isTSTypeCast(node)) return false
  return isTSTypeCast(node.expression)
}

export const noBannedTypeAssertions: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Hard-ban the worst type assertions: `any` anywhere (including nested `as any[]` / `as Record<string, any>`), top-level `as unknown` / `as never`, and double assertions."
    }
  },
  create(context) {
    function report(node: AstNode) {
      const banned = _bannedTargetKind(node)
      if (banned) {
        context.report({
          node,
          message: `\`as ${banned}\` is banned — silently disables the type checker.`
        })
        return
      }
      if (_isDoubleAssertion(node)) {
        context.report({
          node,
          message: "Double type assertions (`x as A as B`) are banned."
        })
      }
    }
    return {
      TSAsExpression: report,
      TSTypeAssertion: report
    }
  }
}
