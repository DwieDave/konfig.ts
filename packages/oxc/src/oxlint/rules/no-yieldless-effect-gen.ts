import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"
import { Option } from "effect"
import { childNodes, effectMemberName } from "../ast.ts"

const _isFunctionLike = (node: ESTree.Node): boolean =>
  node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression"

const _hasYield = (node: ESTree.Node): boolean =>
  node.type === "YieldExpression" || childNodes(node).some((child) => !_isFunctionLike(child) && _hasYield(child))

export const noYieldlessEffectGen = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid `Effect.gen(function*() { ... })` whose body has no `yield*` — use a plain expression with `Effect.succeed`/`Effect.sync`, or (for `Application.define({ build })`) a thunk."
    }
  },
  create(context) {
    return {
      CallExpression(node) {
        const fn = node.arguments[0]

        if (!Option.exists(effectMemberName(node.callee), (name) => name === "gen")) return

        if (fn?.type !== "FunctionExpression" || !fn.generator || (fn.body !== null && _hasYield(fn.body))) return
        context.report({
          node: node.callee,
          message:
            "`Effect.gen(function*() { ... })` has no `yield*` — use `Effect.succeed(value)` (sync return), `Effect.sync(() => ...)`, or a thunk `() => value` if the consumer accepts one (e.g. `Application.define({ build })`)."
        })
      }
    }
  }
})
