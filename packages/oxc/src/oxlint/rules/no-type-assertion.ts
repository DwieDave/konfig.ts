import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

type Assertion = ESTree.TSAsExpression | ESTree.TSTypeAssertion

const _isAsConst = (node: Assertion): boolean =>
  node.typeAnnotation.type === "TSTypeReference" &&
  node.typeAnnotation.typeName.type === "Identifier" &&
  node.typeAnnotation.typeName.name === "const"

export const noTypeAssertion = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Discourage `as` type assertions — prefer schemas / narrowing." }
  },
  create(context) {
    const check = (node: Assertion) => {
      if (_isAsConst(node)) return
      context.report({ node, message: "Avoid `as` type assertions. Prefer schema decoding or proper narrowing." })
    }

    return { TSAsExpression: check, TSTypeAssertion: check }
  }
})
