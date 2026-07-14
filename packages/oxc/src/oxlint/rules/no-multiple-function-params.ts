import { isFunctionLike } from "../types.ts"
import type { AstNode, Rule, RuleContext } from "../types.ts"

const MESSAGE = "Functions with more than one parameter must take a single object parameter (named-args)."

type Scope = "all" | "exports"

const _isScope = (value: unknown): value is Scope => value === "all" || value === "exports"

const _isInsideExport = (context: RuleContext, node: AstNode): boolean => {
  for (const ancestor of context.sourceCode.getAncestors(node)) {
    const t = ancestor.type
    if (
      t === "ExportNamedDeclaration" ||
      t === "ExportDefaultDeclaration" ||
      t === "ExportAllDeclaration"
    ) {
      return true
    }
  }
  return false
}

const _scopeFrom = (context: RuleContext): Scope => {
  const opt = context.options[0]
  if (opt && typeof opt === "object" && "scope" in opt && _isScope(opt.scope)) {
    return opt.scope
  }
  return "exports"
}

const FUNCTION_LIKE = new Set<string>([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression"
])

const _isInlineCallback = (
  context: RuleContext,
  node: AstNode
): boolean => {
  // A function is an "inline callback" if it lives in an expression position
  // nested under a Call/New (directly, in an array, or in a config object literal).
  // Walk up past Property / ObjectExpression / ArrayExpression — those are
  // transparent containers for an inline value — until we hit either the
  // Call/New (exempt) or anything else (not exempt).
  const ancestors = context.sourceCode.getAncestors(node)
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const p = ancestors[i]
    if (!p) return false
    const t = p.type
    if (t === "CallExpression" || t === "NewExpression") return true
    if (t === "ArrayExpression") continue
    if (t === "ObjectExpression" || t === "Property") continue
    return false
  }
  return false
}

const _isNestedInsideFunction = (
  context: RuleContext,
  node: AstNode
): boolean => {
  for (const ancestor of context.sourceCode.getAncestors(node)) {
    if (ancestor === node) continue
    if (FUNCTION_LIKE.has(ancestor.type)) return true
  }
  return false
}

function _check(context: RuleContext, node: AstNode, scope: Scope) {
  if (!isFunctionLike(node)) return
  if (node.params.length <= 1) return
  if (_isInlineCallback(context, node)) return
  if (_isNestedInsideFunction(context, node)) return
  if (scope === "exports" && !_isInsideExport(context, node)) return
  context.report({ node, message: MESSAGE })
}

export const noMultipleFunctionParams: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Multi-arg functions must accept a single object parameter. Default scope: 'exports' — internal helpers may take positional args. Callback TYPE annotations (TSFunctionType) and TS declare-function are exempt: a multi-arg callback contract is the caller's choice."
    },
    schema: [
      {
        type: "object",
        properties: {
          scope: { enum: ["all", "exports"] }
        },
        additionalProperties: false
      }
    ]
  },
  create(context) {
    const scope = _scopeFrom(context)
    return {
      FunctionDeclaration(node) {
        _check(context, node, scope)
      },
      FunctionExpression(node) {
        _check(context, node, scope)
      },
      ArrowFunctionExpression(node) {
        _check(context, node, scope)
      }
    }
  }
}
