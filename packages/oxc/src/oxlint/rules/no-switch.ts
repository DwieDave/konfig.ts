import { defineRule } from "@oxlint/plugins"

export const noSwitch = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Forbid `switch` statements; use `Match` from effect instead." }
  },
  create(context) {
    return {
      SwitchStatement(node) {
        context.report({
          node,
          message: "Avoid `switch`. Use `Match.value(...).pipe(Match.when(...), ...)` from effect."
        })
      }
    }
  }
})
