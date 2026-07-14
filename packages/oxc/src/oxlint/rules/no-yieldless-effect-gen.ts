import { isCallExpression, isFunctionLike, isIdentifier, isMemberExpression } from "../types.ts"
import type { AstNode, Rule } from "../types.ts"

function _isEffectGenCallee(callee: AstNode): boolean {
  if (!isMemberExpression(callee)) return false
  const object = callee.object
  const property = callee.property
  if (!isIdentifier(object) || !isIdentifier(property)) return false
  if (object.name !== "Effect") return false
  if (property.name !== "gen") return false
  return true
}

function _hasYieldExpression(node: AstNode): boolean {
  const stack: Array<AstNode> = [node]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (!cur) continue
    if (cur.type === "YieldExpression") return true
    for (const key of Object.keys(cur)) {
      if (key === "type" || key === "parent" || key === "loc" || key === "range") continue
      const v = cur[key]
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === "object" && "type" in item) {
            stack.push(item as AstNode)
          }
        }
      } else if (v && typeof v === "object" && "type" in v) {
        stack.push(v as AstNode)
      }
    }
  }
  return false
}

export const noYieldlessEffectGen: Rule = {
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
        if (!isCallExpression(node)) return
        const callee = node.callee
        if (!_isEffectGenCallee(callee)) return
        const fn = node.arguments[0]
        if (!fn) return
        if (!isFunctionLike(fn)) return
        if (fn.type === "ArrowFunctionExpression") return
        if (fn.generator !== true) return
        const body = fn.body
        if (!body) return
        if (_hasYieldExpression(body)) return
        context.report({
          node: callee,
          message:
            "`Effect.gen(function*() { ... })` has no `yield*` — use `Effect.succeed(value)` (sync return), `Effect.sync(() => ...)`, or a thunk `() => value` if the consumer accepts one (e.g. `Application.define({ build })`)."
        })
      }
    }
  }
}
