import { defineRule } from "@oxlint/plugins"

export const noBareError = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban `new Error(...)` used as a value. Effect-channel errors must carry a `_tag` via `Data.TaggedError` so they can be matched with `Effect.catchTag`. A synchronous `throw new Error(...)` defect is allowed."
    }
  },
  create(context) {
    return {
      NewExpression(node) {
        const isError = node.callee.type === "Identifier" && node.callee.name === "Error"

        if (isError && node.parent.type !== "ThrowStatement") {
          context.report({
            node,
            message:
              "`new Error(...)` is banned as a value — use `Data.TaggedError` so the error carries a `_tag`. (A synchronous `throw new Error(...)` defect is allowed.)"
          })
        }
      }
    }
  }
})
