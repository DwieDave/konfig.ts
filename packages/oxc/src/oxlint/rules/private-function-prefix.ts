import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

type Reportable = ESTree.Function | ESTree.VariableDeclarator

const _isExportWrapper = (node: ESTree.Node): boolean =>
  node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration"

const _isTopLevel = (node: ESTree.Node): boolean => {
  const parent = node.parent

  return parent?.type === "Program" ||
    (parent !== null && _isExportWrapper(parent) && parent.parent?.type === "Program")
}

const _localExportNames = (program: ESTree.Program): ReadonlySet<string> =>
  new Set(
    program.body.flatMap((statement) => {
      if (statement.type === "ExportNamedDeclaration" && statement.source === null) {
        return statement.specifiers.flatMap((specifier) =>
          specifier.local.type === "Identifier" ? [specifier.local.name] : []
        )
      }

      return statement.type === "ExportDefaultDeclaration" && statement.declaration.type === "Identifier"
        ? [statement.declaration.name]
        : []
    })
  )

const _isFunctionInit = (declarator: ESTree.VariableDeclarator): boolean =>
  declarator.init?.type === "ArrowFunctionExpression" || declarator.init?.type === "FunctionExpression"

const _message = (name: string): string =>
  `Private function \`${name}\` must be prefixed with \`_\` (e.g. \`_${name}\`).`

export const privateFunctionPrefix = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Non-exported top-level functions must be prefixed with `_`." }
  },
  create(context) {
    const exported = _localExportNames(context.sourceCode.ast)

    const check = (input: { readonly node: Reportable; readonly name: string }) => {
      if (input.name.startsWith("_") || exported.has(input.name)) return
      context.report({ node: input.node, message: _message(input.name) })
    }

    return {
      FunctionDeclaration(node) {
        if (_isTopLevel(node) && node.parent !== null && !_isExportWrapper(node.parent) && node.id !== null) {
          check({ node, name: node.id.name })
        }
      },
      VariableDeclaration(node) {
        if (!_isTopLevel(node) || (node.parent !== null && _isExportWrapper(node.parent))) return
        node.declarations.forEach((declarator) => {
          if (_isFunctionInit(declarator) && declarator.id.type === "Identifier") {
            check({ node: declarator, name: declarator.id.name })
          }
        })
      }
    }
  }
})
