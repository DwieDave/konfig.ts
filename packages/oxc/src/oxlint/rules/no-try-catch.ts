import type { AstNode, Rule } from "../types.ts"

export const noTryCatch: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Avoid try/catch. Use Effect.try, Effect.tryPromise, or an explicit error channel instead."
    }
  },
  create(context) {
    return {
      TryStatement(node: AstNode) {
        context.report({
          node,
          message: "Do not use try/catch. Use Effect.try, Effect.tryPromise, or an explicit error channel instead."
        })
      }
    }
  }
}
