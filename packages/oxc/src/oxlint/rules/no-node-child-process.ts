import { isAstNode, isString } from "../types.ts"
import type { AstNode, Rule } from "../types.ts"

const BANNED_MODULES = new Set(["node:child_process"])

function _importSource(node: AstNode): string | null {
  if (node.type !== "ImportDeclaration" || !isAstNode(node.source)) return null
  const value = node.source.value

  return isString(value) ? value : null
}

export const noNodeChildProcess: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban importing `node:child_process`. Raw shell invocations risk command injection and diverge from the repo's tagged-error subprocess convention — use effect `ChildProcess` via `runProcessString` / `runProcessExit` instead."
    }
  },
  create(context) {
    return {
      ImportDeclaration(node: AstNode) {
        const source = _importSource(node)

        if (source !== null && BANNED_MODULES.has(source)) {
          context.report({
            node,
            message:
              "`node:child_process` is banned — use effect `ChildProcess` (`runProcessString`/`runProcessExit`) instead of shelling out directly."
          })
        }
      }
    }
  }
}
