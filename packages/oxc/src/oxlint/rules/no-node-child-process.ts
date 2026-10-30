import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

const BANNED_MODULES = new Set(["node:child_process", "child_process"])

const MESSAGE =
  "`child_process` is banned — use effect `ChildProcess` (`runProcessString`/`runProcessExit`) instead of shelling out directly."

const _isBannedLiteral = (node: ESTree.Node | null | undefined): boolean =>
  node?.type === "Literal" && BANNED_MODULES.has(String(node.value))

const _isBannedRequire = (node: ESTree.CallExpression): boolean =>
  node.callee.type === "Identifier" && node.callee.name === "require" && _isBannedLiteral(node.arguments[0])

export const noNodeChildProcess = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban `child_process` and `node:child_process` in import and export-from declarations, `require()` calls and `import()` expressions. Raw shell invocations risk command injection and diverge from the repo's tagged-error subprocess convention — use effect `ChildProcess` via `runProcessString` / `runProcessExit` instead."
    }
  },
  create(context) {
    const reportIf = (input: { readonly node: ESTree.Node; readonly banned: boolean }) => {
      if (input.banned) context.report({ node: input.node, message: MESSAGE })
    }

    return {
      ImportDeclaration: (node) => reportIf({ node, banned: _isBannedLiteral(node.source) }),
      ExportAllDeclaration: (node) => reportIf({ node, banned: _isBannedLiteral(node.source) }),
      ExportNamedDeclaration: (node) => reportIf({ node, banned: _isBannedLiteral(node.source) }),
      ImportExpression: (node) => reportIf({ node, banned: _isBannedLiteral(node.source) }),
      CallExpression: (node) => reportIf({ node, banned: _isBannedRequire(node) })
    }
  }
})
