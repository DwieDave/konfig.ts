import { isIdentifier, isMemberExpression } from "../types.ts"
import type { AstNode, Rule } from "../types.ts"

export const noServiceOption: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Avoid Effect.serviceOption. Require the service directly and provide it in the layer so missing dependencies fail at composition time."
    }
  },
  create(context) {
    return {
      MemberExpression(node: AstNode) {
        if (!isMemberExpression(node)) return
        if (!isIdentifier(node.object) || node.object.name !== "Effect") return
        if (isIdentifier(node.property) && node.property.name === "serviceOption") {
          context.report({
            node,
            message: "Do not use Effect.serviceOption. Require the service directly and provide it in the layer."
          })
        }
      }
    }
  }
}
