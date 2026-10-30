import type { ESTree } from "@oxlint/plugins"
import { Option, Predicate } from "effect"

export interface MemberNames {
  readonly object: string
  readonly property: string
}

export const memberNames = (node: ESTree.Node): Option.Option<MemberNames> =>
  node.type === "MemberExpression" && node.object.type === "Identifier" && node.property.type === "Identifier"
    ? Option.some({ object: node.object.name, property: node.property.name })
    : Option.none()

export const effectMemberName = (node: ESTree.Node): Option.Option<string> =>
  memberNames(node).pipe(
    Option.filter(({ object }) => object === "Effect"),
    Option.map(({ property }) => property)
  )

const SKIPPED_KEYS = new Set(["type", "loc", "parent", "range", "start", "end"])

export const isNode = (value: unknown): value is ESTree.Node =>
  Predicate.hasProperty(value, "type") && Predicate.isString(value.type)

export const childNodes = (node: ESTree.Node): readonly ESTree.Node[] =>
  Object.entries(node)
    .filter(([key]) => !SKIPPED_KEYS.has(key))
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
    .filter(isNode)

export const ancestorsOf = (node: ESTree.Node): ReadonlyArray<ESTree.Node> =>
  node.parent === null ? [] : [...ancestorsOf(node.parent), node.parent]
