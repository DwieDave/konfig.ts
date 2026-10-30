import { isAstNode, isString } from "../types.ts"
import type { AstNode, Rule } from "../types.ts"

const EQUALITY = new Set(["===", "!==", "==", "!="])

function _isTypeof(node: AstNode): boolean {
  return node.type === "UnaryExpression" && node.operator === "typeof"
}

function _isObjectLiteral(node: AstNode): boolean {
  return node.type === "Literal" && node.value === "object"
}

function _isTypeofObjectComparison(node: AstNode): boolean {
  const { left, right, operator } = node

  if (!isString(operator) || !EQUALITY.has(operator) || !isAstNode(left) || !isAstNode(right)) return false

  return (_isTypeof(left) && _isObjectLiteral(right)) || (_isObjectLiteral(left) && _isTypeof(right))
}

export const noTypeofObject: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Avoid `typeof x === \"object\"` checks. Prefer Effect Schema for trust-boundary validation, or an explicit null-and-object guard for in-process narrowing."
    }
  },
  create(context) {
    return {
      BinaryExpression(node: AstNode) {
        if (_isTypeofObjectComparison(node)) {
          context.report({
            node,
            message:
              "Do not compare `typeof` with \"object\". Prefer Effect Schema for trust-boundary data, or an explicit null-and-object guard for in-process narrowing."
          })
        }
      }
    }
  }
}
