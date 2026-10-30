import { defineRule } from "@oxlint/plugins"
import { ancestorsOf } from "../ast.ts"

const EXEMPT_ANCESTORS = new Set([
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
  "TSAsExpression",
  "TSTypeAssertion"
])

export const noAny = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban the `any` type on values. `any` silently disables checking — use `unknown`, an Effect Schema, or a precise type. Type-level erasure (`type AnyX = Foo<any>`) and assertion-position `any` (handled by no-banned-type-assertions) are exempt."
    }
  },
  create(context) {
    return {
      TSAnyKeyword(node) {
        if (ancestorsOf(node).some((ancestor) => EXEMPT_ANCESTORS.has(ancestor.type))) return
        context.report({
          node,
          message: "`any` is banned — use `unknown`, an Effect Schema, or a precise type."
        })
      }
    }
  }
})
