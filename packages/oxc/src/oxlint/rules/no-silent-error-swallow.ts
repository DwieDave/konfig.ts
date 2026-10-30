import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"
import { Option } from "effect"
import { effectMemberName } from "../ast.ts"

type Matcher = (node: ESTree.Node) => boolean

const MESSAGE =
  "Do not silently swallow Effect errors with Effect.void/Effect.ignore/undefined. Recover meaningfully, transform the error, or let it propagate."

const _isVoidEffect: Matcher = (node) => Option.exists(effectMemberName(node), (name) => name === "void")

const _isUndefined: Matcher = (node) => node.type === "Identifier" && node.name === "undefined"

const _returnedExpression = (fn: ESTree.Node): Option.Option<ESTree.Node> => {
  if (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression") return Option.none()

  if (fn.body === null || fn.body.type !== "BlockStatement") return Option.fromNullishOr(fn.body)
  const [statement] = fn.body.body

  return fn.body.body.length === 1 && statement?.type === "ReturnStatement"
    ? Option.fromNullishOr(statement.argument)
    : Option.none()
}

const _matchesOrReturns = (input: { readonly node: ESTree.Node; readonly matcher: Matcher }): boolean =>
  input.matcher(input.node) || Option.exists(_returnedExpression(input.node), input.matcher)

const HANDLER_MATCHERS = new Map<string, Matcher>([
  ["catch", _isVoidEffect],
  ["catchCause", _isVoidEffect],
  ["catchTag", _isVoidEffect],
  ["catchTags", _isVoidEffect],
  ["orElseSucceed", _isUndefined]
])

const _swallowsViaHandler = (node: ESTree.CallExpression): boolean =>
  effectMemberName(node.callee).pipe(
    Option.flatMap((name) => Option.fromNullishOr(HANDLER_MATCHERS.get(name))),
    Option.exists((matcher) => node.arguments.some((argument) => _matchesOrReturns({ node: argument, matcher })))
  )

export const noSilentErrorSwallow = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Do not silently swallow Effect errors with Effect.ignore, Effect.void or undefined recoveries in catch handlers. Recover meaningfully, transform the error, or let it propagate."
    }
  },
  create(context) {
    return {
      CallExpression(node) {
        if (_swallowsViaHandler(node)) context.report({ node, message: MESSAGE })
      },
      MemberExpression(node) {
        if (Option.exists(effectMemberName(node), (name) => name === "ignore")) {
          context.report({ node, message: MESSAGE })
        }
      }
    }
  }
})
