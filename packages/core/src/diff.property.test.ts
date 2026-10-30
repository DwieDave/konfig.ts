import { Predicate } from "effect"
import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { deepEqual, diffFiles, hasDifferences, type Json, redact, redactedEqual } from "./diff"

/** A small alphabet of Kubernetes-shaped documents, YAML-stringified. */
const arbDoc = fc.record({
  kind: fc.constantFrom("ConfigMap", "Service", "Deployment", "Secret"),
  name: fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/),
  value: fc.oneof(fc.string(), fc.integer(), fc.boolean())
})

const _toYaml = (doc: { readonly kind: string; readonly name: string; readonly value: unknown }): string =>
  `apiVersion: v1\nkind: ${doc.kind}\nmetadata:\n  name: ${doc.name}\ndata:\n  v: ${JSON.stringify(doc.value)}\n`

const arbDocSet = fc.uniqueArray(arbDoc, { minLength: 1, maxLength: 6, selector: (d) => `${d.kind}|${d.name}` })

const _multiDocYaml = (
  docs: ReadonlyArray<{ readonly kind: string; readonly name: string; readonly value: unknown }>
): string => docs.map(_toYaml).join("---\n")

/** Arbitrary JSON-ish values that exercise every redact branch: metadata.labels/annotations,
 *  Secret data/stringData, null/undefined keys, numeric strings, nested arrays. */
const arbLeaf = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.boolean(),
  fc.integer({ min: -3, max: 3 }),
  fc.constantFrom("1", "1.0", "-2", "true", "Helm", "x", "<redacted>"),
  fc.double({ noNaN: true, noDefaultInfinity: true, min: -2, max: 2 })
)

const arbKey = fc.constantFrom(
  "a",
  "b",
  "kind",
  "metadata",
  "labels",
  "annotations",
  "data",
  "stringData",
  "helm.sh/chart",
  "app.kubernetes.io/managed-by",
  "meta.helm.sh/release-name",
  "meta.helm.sh/release-namespace"
)

const arbKind = fc.constantFrom("Secret", "ConfigMap", null, undefined)

const arbValue: fc.Arbitrary<Json> = fc.letrec<{ value: Json }>((tie) => ({
  value: fc.oneof(
    { depthSize: "small", maxDepth: 4 },
    arbLeaf,
    fc.array(tie("value"), { maxLength: 3 }),
    fc.dictionary(arbKey, tie("value"), { maxKeys: 5 }).chain((o) =>
      arbKind.map((kind) => (kind === undefined ? o : { ...o, kind }))
    )
  )
})).value

describe("redactedEqual mirrors deepEqual over redact", () => {
  const check = (options: { readonly normalizeNumerics?: boolean }): void => {
    fc.assert(
      fc.property(arbValue, arbValue, (a, b) => {
        const expected = deepEqual({ a: redact({ value: a, options }), b: redact({ value: b, options }) })
        expect(redactedEqual({ a, b, options })).toBe(expected)
        expect(redactedEqual({ a, b: a, options })).toBe(true)
      }),
      { numRuns: 2000 }
    )
  }

  it("without numeric normalization", () => check({}))
  it("with numeric normalization", () => check({ normalizeNumerics: true }))
})

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

        if (Predicate.isTagged(rEntry, "Changed")) {
          expect(rEntry.docs?.some((d) => Predicate.isTagged(d, "MissingRight"))).toBe(true)
        }

        if (Predicate.isTagged(lEntry, "Changed")) {
          expect(lEntry.docs?.some((d) => Predicate.isTagged(d, "MissingLeft"))).toBe(true)
        }
      })
    )
  })
})

describe("redact", () => {
  it("is idempotent", () => {
    for (const options of [{}, { normalizeNumerics: true }]) {
      fc.assert(
        fc.property(arbValue, (value) => {
          const once = redact({ value, options })
          expect(redact({ value: once, options })).toEqual(once)
        }),
        { numRuns: 1000 }
      )
    }
  })

  it("never leaks Secret data values and keeps their keys", () => {
    const arbData = fc.dictionary(fc.stringMatching(/^[a-z]{1,6}$/), fc.string({ minLength: 1 }), { minKeys: 1 })
    fc.assert(
      fc.property(arbData, fc.constantFrom("data", "stringData"), (data, field) => {
        const out = redact({ value: { kind: "Secret", [field]: data } })
        const expected = Object.fromEntries(Object.keys(data).map((k) => [k, "<redacted>"]))
        expect(out).toEqual({ kind: "Secret", [field]: expected })
      })
    )
  })
})
