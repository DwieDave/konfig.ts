import { isCallExpression, isIdentifier, isMemberExpression } from "../types.ts"
import type { AstNode, Rule } from "../types.ts"

const PARSE_METHODS = new Set(["parse", "parseAllDocuments", "parseAll"])

function _isParseCall(node: AstNode): boolean {
  if (!isCallExpression(node)) return false
  const callee = node.callee
  if (!isMemberExpression(callee)) return false
  const obj = callee.object
  if (!isIdentifier(obj)) return false
  if (obj.name !== "YAML" && obj.name !== "JSON") return false
  const prop = callee.property
  return isIdentifier(prop) && PARSE_METHODS.has(prop.name)
}

function _isUnsafeCoerce(node: AstNode): boolean {
  return isIdentifier(node) && node.name === "unsafeCoerce"
}

export const noParseCoercion: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Ban coercing parse results without validation. `YAML.parse`/`JSON.parse` output is untrusted — decode it with Effect Schema (`boundary`) instead of `unsafeCoerce`/`as`."
    }
  },
  create(context) {
    return {
      CallExpression(node: AstNode) {
        if (!isCallExpression(node)) return
        if (!_isUnsafeCoerce(node.callee)) return
        const firstArg = node.arguments[0]
        if (firstArg !== undefined && _isParseCall(firstArg)) {
          context.report({
            node,
            message: "Parse results are untrusted — decode with Effect Schema (`boundary`) instead of coercing."
          })
        }
      }
    }
  }
}
