import type { AstNode, Rule } from "../types.ts"

const BANNED_KEYWORDS = new Set(["TSAnyKeyword", "TSUnknownKeyword", "TSNeverKeyword"])

function _bannedTargetKind(node: AstNode): string | null {
  const ann = node.typeAnnotation as AstNode | undefined
  if (!ann) return null
  if (BANNED_KEYWORDS.has(ann.type)) return ann.type.replace(/^TS|Keyword$/g, "").toLowerCase()
  return null
}

function _isDoubleAssertion(node: AstNode): boolean {
  const inner = node.expression as AstNode | undefined
  return !!inner && (inner.type === "TSAsExpression" || inner.type === "TSTypeAssertion")
}

export const noBannedTypeAssertions: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Hard-ban the worst type assertions: `as any` / `as unknown` / `as never` and double assertions."
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
