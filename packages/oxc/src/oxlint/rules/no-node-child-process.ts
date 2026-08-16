import type { AstNode, Rule } from "../types.ts"

const BANNED_MODULES = new Set(["node:child_process"])

function _importSource(node: AstNode): string | null {
  if (node.type !== "ImportDeclaration") return null
  const source = node.source
  if (typeof source !== "object" || source === null) return null
  const value = (source as AstNode).value
  return typeof value === "string" ? value : null
}

export const noNodeChildProcess: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Ban importing `node:child_process`. Raw shell invocations risk command injection and diverge from the repo's tagged-error subprocess convention — use effect `ChildProcess` via `runProcessString` / `runProcessExit` instead."
    }
  },
  create(context) {
    return {
      ImportDeclaration(node: AstNode) {
        const source = _importSource(node)
        if (source !== null && BANNED_MODULES.has(source)) {
          context.report({
            node,
            message: "`node:child_process` is banned — use effect `ChildProcess` (`runProcessString`/`runProcessExit`) instead of shelling out directly."
          })
        }
      }
    }
  }
}
