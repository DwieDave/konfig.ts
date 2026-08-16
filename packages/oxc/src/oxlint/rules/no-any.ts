import type { AstNode, Rule, RuleContext } from "../types.ts"

const TYPE_LEVEL_ANCESTORS = new Set(["TSTypeAliasDeclaration", "TSInterfaceDeclaration"])

function _isInTypeLevel(node: AstNode, context: RuleContext): boolean {
  return context.sourceCode.getAncestors(node).some((a) => TYPE_LEVEL_ANCESTORS.has(a.type))
}

function _isAssertionPosition(node: AstNode, context: RuleContext): boolean {
  return context.sourceCode
    .getAncestors(node)
    .some((a) => a.type === "TSAsExpression" || a.type === "TSTypeAssertion")
}

export const noAny: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Ban the `any` type on values. `any` silently disables checking — use `unknown`, an Effect Schema, or a precise type. Type-level erasure (`type AnyX = Foo<any>`) and assertion-position `any` (handled by no-banned-type-assertions) are exempt."
    }
  },
  create(context) {
    return {
      TSAnyKeyword(node: AstNode) {
        if (_isInTypeLevel(node, context) || _isAssertionPosition(node, context)) return
        context.report({
          node,
          message: "`any` is banned — use `unknown`, an Effect Schema, or a precise type."
        })
      }
    }
  }
}
