import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"
import { Option } from "effect"

const EXEMPT_PREFIXES = [/^\s*(eslint|oxlint|biome|prettier|@ts-)/, /^\s*konfig:\s*WHY\b/, /^\s*SAFETY:/]
const MAX_COMMENT_LENGTH = 150

const BLOCK_MESSAGE =
  "Non-JSDoc block comments are not allowed — use a `//` line comment, a `/** ... */` JSDoc block on a declaration, or `// konfig: WHY ...` for intentional rationale."

const _lengthMessage = (length: number): string =>
  `Comment exceeds ${MAX_COMMENT_LENGTH} chars (${length}). Split, shorten, or convert to a \`// konfig: WHY ...\` rationale comment.`

const _violation = (comment: ESTree.Comment): Option.Option<string> => {
  if (EXEMPT_PREFIXES.some((prefix) => prefix.test(comment.value))) return Option.none()

  if (comment.type === "Block") return comment.value.startsWith("*") ? Option.none() : Option.some(BLOCK_MESSAGE)

  return comment.value.length > MAX_COMMENT_LENGTH ? Option.some(_lengthMessage(comment.value.length)) : Option.none()
}

export const noComments = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "No non-JSDoc block comments; single-line comments must be at most 150 chars. JSDoc `/** ... */` blocks and `// konfig: WHY ...` are exempt."
    }
  },
  create(context) {
    return {
      Program(node) {
        context.sourceCode.getAllComments().forEach((comment) => {
          Option.map(_violation(comment), (message) => context.report({ node, loc: comment.loc, message }))
        })
      }
    }
  }
})
