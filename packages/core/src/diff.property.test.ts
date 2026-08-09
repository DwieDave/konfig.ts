import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { diffFiles, hasDifferences } from "./diff"

/** A small alphabet of Kubernetes-shaped documents, YAML-stringified. */
const arbDoc = fc.record({
  kind: fc.constantFrom("ConfigMap", "Service", "Deployment", "Secret"),
  name: fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/),
  value: fc.oneof(fc.string(), fc.integer(), fc.boolean())
})

const _toYaml = (doc: { readonly kind: string; readonly name: string; readonly value: unknown }): string =>
  `apiVersion: v1\nkind: ${doc.kind}\nmetadata:\n  name: ${doc.name}\ndata:\n  v: ${JSON.stringify(doc.value)}\n`

const arbDocSet = fc.uniqueArray(arbDoc, { minLength: 1, maxLength: 6, selector: (d) => `${d.kind}|${d.name}` })

const _multiDocYaml = (docs: ReadonlyArray<{ readonly kind: string; readonly name: string; readonly value: unknown }>): string =>
  docs.map(_toYaml).join("---\n")

describe("diff.ts — property tests", () => {
  it("diffing a file against itself is always Same", () => {
    fc.assert(
      fc.property(arbDocSet, (docs) => {
        const text = _multiDocYaml(docs)
        const result = diffFiles({ left: { "x.yaml": text }, right: { "x.yaml": text } })
        expect(hasDifferences(result)).toBe(false)
      })
    )
  })

  it("reordering documents within a multi-doc file never registers as a difference", () => {
    fc.assert(
      fc.property(
        arbDocSet.chain((docs) => fc.tuple(fc.constant(docs), fc.shuffledSubarray(docs, { minLength: docs.length }))),
        ([docs, shuffled]) => {
          const left = _multiDocYaml(docs)
          const right = _multiDocYaml(shuffled)
          const result = diffFiles({ left: { "x.yaml": left }, right: { "x.yaml": right } })
          expect(hasDifferences(result)).toBe(false)
        }
      )
    )
  })

  it("a document present only on the left is reported as missing on the right, and vice versa", () => {
    fc.assert(
      fc.property(arbDocSet, fc.integer({ min: 0, max: 1000 }), (docs, seed) => {
        fc.pre(docs.length >= 2)
        const dropIdx = seed % docs.length
        const remaining = docs.filter((_, i) => i !== dropIdx)

        const full = { "x.yaml": _multiDocYaml(docs) }
        const partial = { "x.yaml": _multiDocYaml(remaining) }

        const removedFromRight = diffFiles({ left: full, right: partial })
        const removedFromLeft = diffFiles({ left: partial, right: full })

        expect(hasDifferences(removedFromRight)).toBe(true)
        expect(hasDifferences(removedFromLeft)).toBe(true)

        const rEntry = removedFromRight.entries[0]
        const lEntry = removedFromLeft.entries[0]
        if (rEntry?._tag === "Changed") {
          expect(rEntry.docs?.some((d) => d._tag === "MissingRight")).toBe(true)
        }
        if (lEntry?._tag === "Changed") {
          expect(lEntry.docs?.some((d) => d._tag === "MissingLeft")).toBe(true)
        }
      })
    )
  })
})
