import { describe, expect, it } from "@effect/vitest"
import { Predicate } from "effect"
import * as fc from "fast-check"
import * as YAML from "yaml"
import { _valuesYaml } from "./Helm"

const _scalar = fc.oneof(
  fc.constantFrom(
    "no",
    "yes",
    "on",
    "off",
    "y",
    "n",
    "~",
    "null",
    "1_000",
    "0o17",
    "0x1F",
    "1e3",
    ".inf",
    "2024-01-01"
  ),
  fc.string()
)

const _values = fc.dictionary(_scalar, fc.oneof(_scalar, fc.constant(null)))

type Visit = { readonly node: YAML.Node | YAML.Pair | null | undefined }

const _stringTypes = ({ node }: Visit): ReadonlyArray<string | undefined> => {
  if (YAML.isScalar(node)) {
    return Predicate.isString(node.value) ? [node.type] : []
  }

  if (YAML.isPair(node)) {
    return [node.key, node.value].filter(YAML.isNode).flatMap((child) => _stringTypes({ node: child }))
  }

  if (YAML.isCollection(node)) {
    return node.items.flatMap((item) => YAML.isNode(item) || YAML.isPair(item) ? _stringTypes({ node: item }) : [])
  }

  return []
}

describe("Helm values file", () => {
  it("round-trips under YAML 1.1 and quotes every string", () => {
    fc.assert(
      fc.property(_values, (values) => {
        const text = _valuesYaml(values)
        expect(YAML.parse(text, { version: "1.1" })).toEqual(values)
        const doc = YAML.parseDocument(text, { version: "1.1" })
        const strings = _stringTypes({ node: doc.contents })
        expect(strings.every((t) => t === "QUOTE_DOUBLE")).toBe(true)
      })
    )
  })
})
