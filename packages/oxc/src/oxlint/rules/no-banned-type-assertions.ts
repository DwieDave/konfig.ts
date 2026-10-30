import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"
import { Option } from "effect"
import { childNodes } from "../ast.ts"

type Assertion = ESTree.TSAsExpression | ESTree.TSTypeAssertion

const TOP_LEVEL_BANNED = new Set(["TSAnyKeyword", "TSUnknownKeyword", "TSNeverKeyword"])

const _keywordName = (type: string): string => type.replace(/^TS|Keyword$/g, "").toLowerCase()

const _containsAny = (node: ESTree.Node): boolean =>
  childNodes(node).some((child) => child.type === "TSAnyKeyword" || _containsAny(child))

const _bannedTargetKind = (node: Assertion): Option.Option<string> => {
  const annotation = node.typeAnnotation

  if (TOP_LEVEL_BANNED.has(annotation.type)) return Option.some(_keywordName(annotation.type))

  return _containsAny(annotation) ? Option.some("any") : Option.none()
}

const _isDoubleAssertion = (node: Assertion): boolean =>
  node.expression.type === "TSAsExpression" || node.expression.type === "TSTypeAssertion"

export const noBannedTypeAssertions = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Hard-ban the worst type assertions: `any` anywhere (including nested `as any[]` / `as Record<string, any>`), top-level `as unknown` / `as never`, and double assertions."
    }
  },
  create(context) {
    const check = (node: Assertion) => {
      const banned = _bannedTargetKind(node)

      if (Option.isSome(banned)) {
        context.report({ node, message: `\`as ${banned.value}\` is banned — silently disables the type checker.` })
      } else if (_isDoubleAssertion(node)) {
        context.report({ node, message: "Double type assertions (`x as A as B`) are banned." })
      }
    }

    return { TSAsExpression: check, TSTypeAssertion: check }
  }
})
