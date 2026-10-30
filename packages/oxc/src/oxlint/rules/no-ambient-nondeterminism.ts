import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"
import { Option } from "effect"
import { memberNames } from "../ast.ts"

const MEMBER_MESSAGES = new Map([
  ["Math.random", "Do not use ambient Math.random. Use Effect's Random capability instead."],
  ["Date.now", "Do not use ambient Date.now. Use Effect's Clock capability instead."]
])

const NEW_DATE_MESSAGE =
  "Do not construct an ambient Date for the current time. Use Effect's Clock/DateTime capability instead."

const _memberMessage = (node: ESTree.MemberExpression): Option.Option<string> =>
  memberNames(node).pipe(
    Option.flatMap(({ object, property }) => Option.fromNullishOr(MEMBER_MESSAGES.get(`${object}.${property}`)))
  )

const _isBareNewDate = (node: ESTree.NewExpression): boolean =>
  node.callee.type === "Identifier" && node.callee.name === "Date" && node.arguments.length === 0

export const noAmbientNondeterminism = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow ambient randomness and time (Math.random, Date.now, new Date()) — use Effect's Random/Clock capabilities so the effect is deterministic and testable."
    }
  },
  create(context) {
    return {
      MemberExpression(node) {
        Option.map(_memberMessage(node), (message) => context.report({ node, message }))
      },
      NewExpression(node) {
        if (_isBareNewDate(node)) context.report({ node, message: NEW_DATE_MESSAGE })
      }
    }
  }
})
