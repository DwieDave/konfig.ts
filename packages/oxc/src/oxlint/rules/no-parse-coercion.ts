import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"
import { Option } from "effect"
import { memberNames } from "../ast.ts"

const PARSE_METHODS = new Set(["parse", "parseAllDocuments", "parseAll"])
const PARSE_NAMESPACES = new Set(["YAML", "JSON"])

const _isParseCall = (node: ESTree.Node): boolean =>
  node.type === "CallExpression" &&
  Option.exists(
    memberNames(node.callee),
    ({ object, property }) => PARSE_NAMESPACES.has(object) && PARSE_METHODS.has(property)
  )

const _isValueProperty = (p: ESTree.ObjectPropertyKind): p is ESTree.ObjectProperty =>
  p.type === "Property" && p.key.type === "Identifier" && p.key.name === "value"

const _valueArg = (node: ESTree.CallExpression): ESTree.Node | undefined => {
  const first = node.arguments[0]

  return first?.type === "ObjectExpression" ? first.properties.find(_isValueProperty)?.value : undefined
}

export const noParseCoercion = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban coercing parse results without validation. `YAML.parse`/`JSON.parse` output is untrusted — decode it with Effect Schema (`boundary`) instead of `unsafeCoerce`/`as`."
    }
  },
  create(context) {
    return {
      CallExpression(node) {
        const isCoerce = node.callee.type === "Identifier" && node.callee.name === "unsafeCoerce"
        const value = _valueArg(node)

        if (isCoerce && value !== undefined && _isParseCall(value)) {
          context.report({
            node,
            message: "Parse results are untrusted — decode with Effect Schema (`boundary`) instead of coercing."
          })
        }
      }
    }
  }
})
