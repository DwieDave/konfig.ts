import { unsafeCoerce } from "@konfig.ts/core"
import type { Context, ESTree, Rule } from "@oxlint/plugins"
import { Predicate } from "effect"
import { parseSync } from "oxc-parser"
import { childNodes, isNode } from "./ast.ts"

export interface LintInput {
  readonly rule: Rule
  readonly source: string
  readonly options?: ReadonlyArray<unknown>
  readonly filename?: string
}

const _link = (input: { readonly node: ESTree.Node; readonly parent: ESTree.Node | null }): void => {
  Object.defineProperty(input.node, "parent", { value: input.parent, enumerable: false, configurable: true })
  childNodes(input.node).forEach((child) => _link({ node: child, parent: input.node }))
}

const _visit = (input: { readonly listener: object; readonly node: ESTree.Node }): void => {
  Object.entries(input.listener).forEach(([type, handler]) => {
    if (type === input.node.type && Predicate.isFunction(handler)) handler(input.node)
  })
  childNodes(input.node).forEach((child) => _visit({ listener: input.listener, node: child }))
}

const _contextFor = (input: {
  readonly comments: ReadonlyArray<ESTree.Comment>
  readonly program: ESTree.Program
  readonly options: ReadonlyArray<unknown>
  readonly filename: string
  readonly messages: string[]
}): Context =>
  unsafeCoerce<Context>(
    {
      id: "test/rule",
      filename: input.filename,
      options: input.options,
      sourceCode: { getAllComments: () => input.comments, ast: input.program },
      report: (diagnostic: { readonly message?: string }) => input.messages.push(diagnostic.message ?? "")
    },
    "the harness provides exactly the context members the rules read"
  )

/** Parses `source` with oxc-parser, runs `rule` over the real AST and returns the reported messages. */
export const lint = (input: LintInput): ReadonlyArray<string> => {
  const filename = input.filename ?? "test.ts"
  const parsed = parseSync(filename, input.source)
  const messages: string[] = []
  const program: unknown = parsed.program

  if (!isNode(program) || input.rule.create === undefined) throw new TypeError("rule or program unusable")
  _link({ node: program, parent: null })

  const context = _contextFor({
    comments: unsafeCoerce(parsed.comments, "oxc-parser comments follow the ESTree comment shape"),
    options: input.options ?? [],
    filename,
    messages,
    program: unsafeCoerce(program, "the parsed program is an ESTree Program")
  })

  _visit({ listener: input.rule.create(context), node: program })

  return messages
}
