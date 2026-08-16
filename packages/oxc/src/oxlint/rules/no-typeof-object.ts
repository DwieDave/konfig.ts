import type { AstNode, Rule } from "../types.ts"

const EQUALITY = new Set(["===", "!==", "==", "!="])

function _isTypeof(node: unknown): boolean {
  return (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    "operator" in node &&
    node.type === "UnaryExpression" &&
    node.operator === "typeof"
  )
}

function _isObjectLiteral(node: unknown): boolean {
  return (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    "value" in node &&
    node.type === "Literal" &&
    node.value === "object"
  )
}

export const noTypeofObject: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: 'Avoid `typeof x === "object"` checks. Prefer Effect Schema for trust-boundary validation, or an explicit null-and-object guard for in-process narrowing.'
    }
  },
  create(context) {
    return {
      BinaryExpression(node: AstNode) {
        if (typeof node.operator !== "string" || !EQUALITY.has(node.operator)) return
        const left = node.left
        const right = node.right
        const hit = (_isTypeof(left) && _isObjectLiteral(right)) || (_isObjectLiteral(left) && _isTypeof(right))
        if (hit) {
          context.report({
            node,
            message: 'Do not compare `typeof` with "object". Prefer Effect Schema for trust-boundary data, or an explicit null-and-object guard for in-process narrowing.'
          })
        }
      }
    }
  }
}
