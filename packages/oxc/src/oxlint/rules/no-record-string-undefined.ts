import { isTSTypeReference } from "../types.ts"
import type { AstNode, Rule } from "../types.ts"

function _typeArguments(node: AstNode): readonly AstNode[] | null {
  const args = node.typeArguments ?? node.typeParameters
  if (typeof args !== "object" || args === null) return null
  const params = (args as AstNode).params
  return Array.isArray(params) ? (params as readonly AstNode[]) : null
}

function _isRecordStringUndefined(node: AstNode): boolean {
  if (!isTSTypeReference(node)) return false
  if (node.typeName.type !== "Identifier" || node.typeName.name !== "Record") return false
  const params = _typeArguments(node)
  if (params === null || params.length !== 2) return false
  return params[0]?.type === "TSStringKeyword" && params[1]?.type === "TSUndefinedKeyword"
}

export const noRecordStringUndefined: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Ban the `Record<string, undefined>` type — it describes an object whose values can only be `undefined`, which is never what you want."
    }
  },
  create(context) {
    return {
      TSTypeReference(node) {
        if (_isRecordStringUndefined(node)) {
          context.report({
            node,
            message: "`Record<string, undefined>` is banned — its values can only ever be `undefined`."
          })
        }
      }
    }
  }
}
