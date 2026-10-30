import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"
import { Option } from "effect"
import { memberNames } from "../ast.ts"

const SYNC_APIS = new Set(["decodeSync", "decodeUnknownSync", "encodeSync", "encodeUnknownSync", "asserts"])
const SCHEMA_NAMESPACES = new Set(["Schema", "S"])
const SCHEMA_MODULES = new Set(["effect/Schema"])

const _message = (api: string): string =>
  `\`${api}\` throws on failure. Use the Effect, Exit, Option or Result variant instead.`

const _namespacedApi = (input: {
  readonly callee: ESTree.Node
  readonly namespaces: ReadonlySet<string>
}): Option.Option<string> =>
  memberNames(input.callee).pipe(
    Option.filter(({ object, property }) =>
      (SCHEMA_NAMESPACES.has(object) || input.namespaces.has(object)) && SYNC_APIS.has(property)
    ),
    Option.map(({ object, property }) => `${object}.${property}`)
  )

const _importedSyncLocals = (node: ESTree.ImportDeclaration): readonly string[] =>
  SCHEMA_MODULES.has(node.source.value)
    ? node.specifiers.flatMap((specifier) =>
      specifier.type === "ImportSpecifier" &&
        specifier.imported.type === "Identifier" &&
        SYNC_APIS.has(specifier.imported.name)
        ? [specifier.local.name]
        : []
    )
    : []

const _namespaceLocals = (node: ESTree.ImportDeclaration): readonly string[] =>
  SCHEMA_MODULES.has(node.source.value)
    ? node.specifiers.flatMap((specifier) =>
      specifier.type === "ImportNamespaceSpecifier" ? [specifier.local.name] : []
    )
    : []

export const noSyncSchemaApis = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid synchronous Effect Schema APIs (they throw); prefer the Effect, Exit, Option or Result variants."
    }
  },
  create(context) {
    const importedLocals = new Set<string>()
    const namespaces = new Set<string>()

    return {
      ImportDeclaration(node) {
        _importedSyncLocals(node).forEach((local) => importedLocals.add(local))
        _namespaceLocals(node).forEach((local) => namespaces.add(local))
      },
      CallExpression(node) {
        const api = node.callee.type === "Identifier" && importedLocals.has(node.callee.name)
          ? Option.some(node.callee.name)
          : _namespacedApi({ callee: node.callee, namespaces })

        Option.map(api, (name) => context.report({ node: node.callee, message: _message(name) }))
      }
    }
  }
})
