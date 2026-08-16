import { isIdentifier, isMemberExpression } from "../types.ts"
import type { AstNode, Rule } from "../types.ts"

export const noEffectAsVoid: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Avoid Effect.asVoid. Return the effect directly when its success type is already void."
    }
  },
  create(context) {
    return {
      MemberExpression(node: AstNode) {
        if (!isMemberExpression(node)) return
        if (!isIdentifier(node.object) || node.object.name !== "Effect") return
        if (isIdentifier(node.property) && node.property.name === "asVoid") {
          context.report({
            node,
            message: "Avoid Effect.asVoid. Return the effect directly when its success type is already void."
          })
        }
      }
    }
  }
}
