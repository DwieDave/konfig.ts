import { isIdentifier, isTSTypeCast, isTSTypeReference } from "../types.ts"
import type { AstNode, Rule } from "../types.ts"

function _isAsConst(node: AstNode): boolean {
  if (!isTSTypeCast(node)) return false
  const ann = node.typeAnnotation
  if (!isTSTypeReference(ann)) return false
  const typeName = ann.typeName
  return isIdentifier(typeName) && typeName.name === "const"
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
