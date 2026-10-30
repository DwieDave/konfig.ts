import { defineRule } from "@oxlint/plugins"

export const noTryCatch = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Avoid try/catch. Use Effect.try, Effect.tryPromise, or an explicit error channel instead."
    }
  },
  create(context) {
    return {
      TryStatement(node) {
        context.report({
          node,
          message: "Do not use try/catch. Use Effect.try, Effect.tryPromise, or an explicit error channel instead."
        })
      }
    }
  }
})
