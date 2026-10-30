import { defineRule } from "@oxlint/plugins"

const BANNED_MODULES = new Set(["node:child_process"])

export const noNodeChildProcess = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban importing `node:child_process`. Raw shell invocations risk command injection and diverge from the repo's tagged-error subprocess convention — use effect `ChildProcess` via `runProcessString` / `runProcessExit` instead."
    }
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (BANNED_MODULES.has(node.source.value)) {
          context.report({
            node,
            message:
              "`node:child_process` is banned — use effect `ChildProcess` (`runProcessString`/`runProcessExit`) instead of shelling out directly."
          })
        }
      }
    }
  }
})
