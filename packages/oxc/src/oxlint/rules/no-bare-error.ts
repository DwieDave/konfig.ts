import type { AstNode, Rule } from "../types.ts"

function _calleeName(node: AstNode): string | null {
  if (node.type !== "NewExpression") return null
  const callee = node.callee
  if (typeof callee !== "object" || callee === null) return null
  const c = callee as AstNode
  return c.type === "Identifier" && typeof c.name === "string" ? c.name : null
}

function _isThrown(node: AstNode): boolean {
  return node.parent?.type === "ThrowStatement"
}

export const noBareError: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Ban `new Error(...)` used as a value. Effect-channel errors must carry a `_tag` via `Data.TaggedError` so they can be matched with `Effect.catchTag`. A synchronous `throw new Error(...)` defect is allowed."
    }
  },
  create(context) {
    return {
      NewExpression(node: AstNode) {
        if (_calleeName(node) === "Error" && !_isThrown(node)) {
          context.report({
            node,
            message: "`new Error(...)` is banned as a value — use `Data.TaggedError` so the error carries a `_tag`. (A synchronous `throw new Error(...)` defect is allowed.)"
          })
        }
      }
    }
  }
}
