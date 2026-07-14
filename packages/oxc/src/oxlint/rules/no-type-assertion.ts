import type { AstNode, Rule } from "../types.ts"

function _isAsConst(node: AstNode): boolean {
  const ann = node.typeAnnotation as AstNode | undefined
  if (!ann || ann.type !== "TSTypeReference") return false
  const typeName = ann.typeName as AstNode | undefined
  return !!typeName && typeName.type === "Identifier" && typeName.name === "const"
}

export const noTypeAssertion: Rule = {
  meta: {
    type: "suggestion",
    docs: { description: "Discourage `as` type assertions — prefer schemas / narrowing." }
  },
  create(context) {
    function report(node: AstNode) {
      if (_isAsConst(node)) return
      context.report({
        node,
        message: "Avoid `as` type assertions. Prefer schema decoding or proper narrowing."
      })
    }
    return {
      TSAsExpression: report,
      TSTypeAssertion: report
    }
  }
}
