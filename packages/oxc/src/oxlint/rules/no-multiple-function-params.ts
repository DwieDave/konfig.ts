import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"
import { Option, Predicate } from "effect"
import { ancestorsOf, effectMemberName } from "../ast.ts"

type Scope = "all" | "exports"

type FunctionNode = ESTree.Function | ESTree.ArrowFunctionExpression

const MESSAGE = "Functions with more than one parameter must take a single object parameter (named-args)."
const EXPORT_TYPES = new Set(["ExportNamedDeclaration", "ExportDefaultDeclaration", "ExportAllDeclaration"])
const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"])
const CONTAINER_TYPES = new Set(["ArrayExpression", "ObjectExpression", "Property"])
const EFFECT_FN_MEMBERS = new Set(["fn", "fnUntraced"])

const _scopeFrom = (options: ReadonlyArray<unknown>): Scope => {
  const option = options[0]

  return Predicate.hasProperty(option, "scope") && option.scope === "all" ? "all" : "exports"
}

const _isEffectFnCallee = (callee: ESTree.Node): boolean =>
  Option.exists(effectMemberName(callee), (name) => EFFECT_FN_MEMBERS.has(name)) ||
  (callee.type === "CallExpression" && _isEffectFnCallee(callee.callee))

const _isEffectFnWrapper = (node: FunctionNode): boolean =>
  node.parent.type === "CallExpression" && _isEffectFnCallee(node.parent.callee)

const _isInlineCallback = (ancestors: ReadonlyArray<ESTree.Node>): boolean => {
  const nearest = [...ancestors].reverse().find((ancestor) => !CONTAINER_TYPES.has(ancestor.type))

  return nearest?.type === "CallExpression" || nearest?.type === "NewExpression"
}

const _shouldReport = (
  input: { readonly node: FunctionNode; readonly ancestors: ReadonlyArray<ESTree.Node>; readonly scope: Scope }
): boolean => {
  const { ancestors, node, scope } = input
  const isExported = ancestors.some((ancestor) => EXPORT_TYPES.has(ancestor.type))
  const isCallback = _isInlineCallback(ancestors) && !_isEffectFnWrapper(node)
  const isNested = ancestors.some((ancestor) => FUNCTION_TYPES.has(ancestor.type))

  return node.params.length > 1 && !isCallback && !isNested && (scope === "all" || isExported)
}

export const noMultipleFunctionParams = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Multi-arg functions must accept a single object parameter. Default scope: 'exports' — internal helpers may take positional args. Exported Effect.fn wrappers count as exports. Callback TYPE annotations (TSFunctionType) and TS declare-function are exempt: a multi-arg callback contract is the caller's choice."
    },
    schema: [{ type: "object", properties: { scope: { enum: ["all", "exports"] } }, additionalProperties: false }]
  },
  create(context) {
    const scope = _scopeFrom(context.options)

    const check = (node: FunctionNode) => {
      if (_shouldReport({ node, ancestors: ancestorsOf(node), scope })) {
        context.report({ node, message: MESSAGE })
      }
    }

    return { FunctionDeclaration: check, FunctionExpression: check, ArrowFunctionExpression: check }
  }
})
