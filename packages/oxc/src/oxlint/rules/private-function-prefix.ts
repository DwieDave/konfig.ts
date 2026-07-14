import { isFunctionLike, isIdentifier, isVariableDeclaration } from "../types.ts"
import type { AstNode, Rule } from "../types.ts"

function _isExportedDeclaration(node: AstNode): boolean {
  const parent = node.parent
  if (!parent) return false
  return parent.type === "ExportNamedDeclaration" || parent.type === "ExportDefaultDeclaration"
}

function _isTopLevelDeclaration(node: AstNode): boolean {
  const parent = node.parent
  if (!parent) return false
  if (parent.type === "Program") return true
  if (parent.type === "ExportNamedDeclaration" || parent.type === "ExportDefaultDeclaration") {
    return parent.parent?.type === "Program"
  }
  return false
}

function _reportIfBare(
  context: Parameters<Rule["create"]>[0],
  node: AstNode,
  name: string | undefined
) {
  if (!name) return
  if (name.startsWith("_")) return
  context.report({
    node,
    message: `Private function \`${name}\` must be prefixed with \`_\` (e.g. \`_${name}\`).`
  })
}

export const privateFunctionPrefix: Rule = {
  meta: {
    type: "suggestion",
    docs: { description: "Non-exported top-level functions must be prefixed with `_`." }
  },
  create(context) {
    return {
      FunctionDeclaration(node) {
        if (!_isTopLevelDeclaration(node)) return
        if (_isExportedDeclaration(node)) return
        if (!isFunctionLike(node)) return
        const id = node.id
        _reportIfBare(context, node, id && isIdentifier(id) ? id.name : undefined)
      },
      VariableDeclaration(node) {
        if (!_isTopLevelDeclaration(node)) return
        if (_isExportedDeclaration(node)) return
        if (!isVariableDeclaration(node)) return
        for (const decl of node.declarations) {
          const init = decl.init
          if (!init) continue
          if (init.type !== "ArrowFunctionExpression" && init.type !== "FunctionExpression") {
            continue
          }
          const id = decl.id
          if (!isIdentifier(id)) continue
          _reportIfBare(context, decl, id.name)
        }
      }
    }
  }
}
