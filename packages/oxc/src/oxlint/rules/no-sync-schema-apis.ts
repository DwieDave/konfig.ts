import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"
import { Option } from "effect"
import { memberNames } from "../ast.ts"

const SYNC_APIS = new Set(["decodeSync", "decodeUnknownSync", "encodeSync", "encodeUnknownSync", "asserts"])
const THROWING_UNWRAP_OBJECTS = new Set(["Result", "Option"])
const SAFE_VARIANT = /^(decode|encode)(Unknown)?(Result|Option)$/
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

const _isSafeVariantFactory = (input: {
  readonly node: ESTree.Node
  readonly namespaces: ReadonlySet<string>
}): boolean =>
  input.node.type === "CallExpression" &&
  memberNames(input.node.callee).pipe(
    Option.exists(({ object, property }) =>
      (SCHEMA_NAMESPACES.has(object) || input.namespaces.has(object)) && SAFE_VARIANT.test(property)
    )
  )

const _isSchemaDecodeCall = (input: {
  readonly node: ESTree.Node | undefined
  readonly namespaces: ReadonlySet<string>
  readonly decoders: ReadonlySet<string>
}): boolean => {
  const { node } = input

  return node?.type === "CallExpression" &&
    ((node.callee.type === "Identifier" && input.decoders.has(node.callee.name)) ||
      _isSafeVariantFactory({ node: node.callee, namespaces: input.namespaces }))
}

const _unwrapName = (callee: ESTree.Node): Option.Option<string> =>
  memberNames(callee).pipe(
    Option.filter(({ object, property }) => THROWING_UNWRAP_OBJECTS.has(object) && property === "getOrThrow"),
    Option.map(({ object }) => `${object}.getOrThrow`)
  )

export const noSyncSchemaApis = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid synchronous Effect Schema APIs (they throw); prefer the Effect, Exit, Option or Result variants. Also flags Result.getOrThrow / Option.getOrThrow applied to a Schema decode/encode Result or Option call, including via a decoder stored in a local."
    }
  },
  create(context) {
    const importedLocals = new Set<string>()
    const namespaces = new Set<string>()
    const decoders = new Set<string>()

    return {
      ImportDeclaration(node) {
        _importedSyncLocals(node).forEach((local) => importedLocals.add(local))
        _namespaceLocals(node).forEach((local) => namespaces.add(local))
      },
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && node.init && _isSafeVariantFactory({ node: node.init, namespaces })) {
          decoders.add(node.id.name)
        }
      },
      CallExpression(node) {
        if (_isSchemaDecodeCall({ node: node.arguments[0], namespaces, decoders })) {
          Option.map(_unwrapName(node.callee), (name) => context.report({ node: node.callee, message: _message(name) }))
        }

        const api = node.callee.type === "Identifier" && importedLocals.has(node.callee.name)
          ? Option.some(node.callee.name)
          : _namespacedApi({ callee: node.callee, namespaces })

        Option.map(api, (name) => context.report({ node: node.callee, message: _message(name) }))
      }
    }
  }
})
