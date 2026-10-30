import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

const _isRecordStringUndefined = (node: ESTree.TSTypeReference): boolean => {
  const params = node.typeArguments?.params

  return (
    node.typeName.type === "Identifier" &&
    node.typeName.name === "Record" &&
    params?.length === 2 &&
    params[0]?.type === "TSStringKeyword" &&
    params[1]?.type === "TSUndefinedKeyword"
  )
}

export const noRecordStringUndefined = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban the `Record<string, undefined>` type — it describes an object whose values can only be `undefined`, which is never what you want."
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
})
