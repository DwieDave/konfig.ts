import type { AstNode, Rule } from "../types.ts"

// Bans non-JSDoc block comments and caps line-comment length; JSDoc, directives
// (eslint/oxlint/biome/prettier/@ts-), and `// konfig: WHY ...` are exempt.
const DIRECTIVE_PREFIX = /^\s*(eslint|oxlint|biome|prettier|@ts-)/
const WHY_PREFIX = /^\s*konfig:\s*WHY\b/
const MAX_COMMENT_LENGTH = 150

const _isJsDoc = (value: string): boolean => value.startsWith("*")

export const noComments: Rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "No non-JSDoc block comments; single-line comments must be < 150 chars. JSDoc `/** ... */` blocks and `// konfig: WHY ...` are exempt."
    }
  },
  create(context) {
    return {
      Program(node: AstNode) {
        for (const comment of context.sourceCode.getAllComments()) {
          if (DIRECTIVE_PREFIX.test(comment.value)) continue
          if (WHY_PREFIX.test(comment.value)) continue
          if (comment.type === "Block") {
            if (_isJsDoc(comment.value)) continue
            context.report({
              loc: comment.loc,
              node,
              message:
                "Non-JSDoc block comments are not allowed — use a `//` line comment, a `/** ... */` JSDoc block on a declaration, or `// konfig: WHY ...` for intentional rationale."
            })
            continue
          }
          if (comment.value.length > MAX_COMMENT_LENGTH) {
            context.report({
              loc: comment.loc,
              node,
              message:
                `Comment exceeds ${MAX_COMMENT_LENGTH} chars (${comment.value.length}). Split, shorten, or convert to a \`// konfig: WHY ...\` rationale comment.`
            })
          }
        }
      }
    }
  }
}
