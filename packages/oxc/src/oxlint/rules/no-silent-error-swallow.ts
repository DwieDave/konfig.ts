import { isCallExpression, isIdentifier, isMemberExpression } from "../types.ts"
import type { AstNode, Rule } from "../types.ts"

const CATCH_METHODS = new Set(["catchAll", "catch", "catchTag", "catchTags"])
const VOID_METHODS = new Set(["void", "unit"])

function _effectMemberName(node: AstNode): string | null {
  if (!isMemberExpression(node)) return null
  if (!isIdentifier(node.object) || node.object.name !== "Effect") return null
  return isIdentifier(node.property) ? node.property.name : null
}

function _isVoidEffect(node: AstNode): boolean {
  const name = _effectMemberName(node)
  return name !== null && VOID_METHODS.has(name)
}

// An arrow/function whose body is `Effect.void` (expression or single `return Effect.void`).
function _returnsVoidEffect(node: AstNode): boolean {
  const body = node.body as AstNode | undefined
  if (typeof body !== "object" || body === null) return false
  if (_isVoidEffect(body)) return true
  if (body.type !== "BlockStatement") return false
  const statements = body.body
  if (!Array.isArray(statements) || statements.length !== 1) return false
  const statement = statements[0] as AstNode
  return statement.type === "ReturnStatement" && _isVoidEffect(statement.argument as AstNode)
}

export const noSilentErrorSwallow: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Do not silently swallow Effect errors with Effect.void/Effect.unit in catch handlers. Recover meaningfully, transform the error, or let it propagate."
    }
  },
  create(context) {
    return {
      CallExpression(node: AstNode) {
        if (!isCallExpression(node)) return
        if (_effectMemberName(node.callee) === null) return
        const name = _effectMemberName(node.callee)
        if (name === null || !CATCH_METHODS.has(name)) return
        for (const argument of node.arguments) {
          if (_isVoidEffect(argument) || _returnsVoidEffect(argument)) {
            context.report({
              node,
              message: "Do not silently swallow Effect errors with Effect.void/Effect.unit. Recover meaningfully, transform the error, or let it propagate."
            })
            return
          }
        }
      }
    }
  }
}
