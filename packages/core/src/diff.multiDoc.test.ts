import { Predicate } from "effect"
import { describe, expect, it } from "vitest"
import { diffFiles, hasDifferences, parseYamlAll, redact } from "./diff"

const MULTI_DOC_LEFT = `apiVersion: v1
kind: ConfigMap
metadata:
  name: cm
data:
  k: v
---
apiVersion: v1
kind: Service
metadata:
  name: svc
spec:
  ports:
    - port: 80
`

const MULTI_DOC_RIGHT_REORDERED = `apiVersion: v1
kind: Service
metadata:
  name: svc
spec:
  ports:
    - port: 80
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: cm
data:
  k: v
`

const MULTI_DOC_RIGHT_CHANGED = `apiVersion: v1
kind: ConfigMap
metadata:
  name: cm
data:
  k: v2
---
apiVersion: v1
kind: Service
metadata:
  name: svc
spec:
  ports:
    - port: 80
`

describe("parseYamlAll", () => {
  it("returns a tuple of parsed docs in source order", () => {
    const docs = parseYamlAll(MULTI_DOC_LEFT)
    expect(docs).toHaveLength(2)
    expect(docs[0]).toMatchObject({ kind: "ConfigMap" })
    expect(docs[1]).toMatchObject({ kind: "Service" })
  })

  it("drops empty / whitespace-only fragments", () => {
    const docs = parseYamlAll("---\n---\napiVersion: v1\nkind: Foo\n---\n")
    expect(docs).toHaveLength(1)
  })
})

describe("diffFiles multi-doc handling", () => {
  it("ignores document reordering within a file (keyed by kind+name+ns)", () => {
    const left = { "out.yaml": MULTI_DOC_LEFT }
    const right = { "out.yaml": MULTI_DOC_RIGHT_REORDERED }
    const result = diffFiles({ left, right })
    expect(hasDifferences(result)).toBe(false)
  })

  it("attributes a single doc's change without flagging the whole file", () => {
    const left = { "out.yaml": MULTI_DOC_LEFT }
    const right = { "out.yaml": MULTI_DOC_RIGHT_CHANGED }
    const result = diffFiles({ left, right })
    expect(hasDifferences(result)).toBe(true)
    const entry = result.entries[0]
    expect(entry?._tag).toBe("Changed")

    if (Predicate.isTagged(entry, "Changed")) {
      expect(entry.docs).toBeDefined()
      const changedDocs = entry.docs?.filter((d) => !Predicate.isTagged(d, "Same")) ?? []
      expect(changedDocs).toHaveLength(1)
      expect(changedDocs[0]?.key).toContain("ConfigMap")
    }
  })

  it("flags an added document on one side as MissingLeft", () => {
    const left = { "out.yaml": MULTI_DOC_LEFT }

    const right = {
      "out.yaml": `${MULTI_DOC_LEFT}---\napiVersion: v1\nkind: Namespace\nmetadata:\n  name: extra\n`
    }

    const result = diffFiles({ left, right })
    const entry = result.entries[0]
    expect(entry?._tag).toBe("Changed")

    if (Predicate.isTagged(entry, "Changed")) {
      const missingLeft = entry.docs?.find((d) => Predicate.isTagged(d, "MissingLeft"))
      expect(missingLeft).toBeDefined()
      expect(missingLeft?.key).toContain("Namespace")
    }
  })

  it("flags a removed document (present only on the left) as MissingRight", () => {
    const left = {
      "out.yaml": `${MULTI_DOC_LEFT}---\napiVersion: v1\nkind: Namespace\nmetadata:\n  name: extra\n`
    }

    const right = { "out.yaml": MULTI_DOC_LEFT }
    const result = diffFiles({ left, right })
    const entry = result.entries[0]
    expect(entry?._tag).toBe("Changed")

    if (Predicate.isTagged(entry, "Changed")) {
      const missingRight = entry.docs?.find((d) => Predicate.isTagged(d, "MissingRight"))
      expect(missingRight).toBeDefined()
      expect(missingRight?.key).toContain("Namespace")

      if (Predicate.isTagged(missingRight, "MissingRight")) {
        expect(missingRight.left).toMatchObject({ kind: "Namespace" })
      }
    }
  })
})

describe("redact numeric normalization", () => {
  it("treats '1.0' (string) and 1 (number) as equal when normalizeNumerics is on", () => {
    const left = { "x.yaml": "value: 1.0\n" }
    const right = { "x.yaml": "value: 1\n" }
    const lax = diffFiles({ left, right, options: { normalizeNumerics: true } })
    expect(hasDifferences(lax)).toBe(false)
  })

  it("default behavior keeps the YAML library's coercion (1.0 → 1 number unifies anyway)", () => {
    const out = redact({ value: { x: "1.0" } })
    expect(out).toEqual({ x: "1.0" })
  })

  it("normalizes a numeric string deep inside a map", () => {
    const out = redact({
      value: { spec: { replicas: "3" } },
      options: { normalizeNumerics: true }
    })

    expect(out).toEqual({ spec: { replicas: 3 } })
  })
})

describe("diffFiles — duplicate document identities", () => {
  const doc = (v: string) => `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: cm\ndata:\n  k: ${v}\n`
  const file = (a: string, b: string) => `${doc(a)}---\n${doc(b)}`

  it("reports a change in the first of two same-key docs", () => {
    const result = diffFiles({ left: { "f.yaml": file("1", "2") }, right: { "f.yaml": file("9", "2") } })
    expect(hasDifferences(result)).toBe(true)
  })

  it("reports a change in the last of two same-key docs", () => {
    const result = diffFiles({ left: { "f.yaml": file("1", "2") }, right: { "f.yaml": file("1", "9") } })
    expect(hasDifferences(result)).toBe(true)
  })

  it("reports a removed duplicate", () => {
    const result = diffFiles({ left: { "f.yaml": file("1", "2") }, right: { "f.yaml": `${doc("1")}---\n${doc("1")}` } })
    expect(hasDifferences(result)).toBe(true)
  })

  it("keeps identical duplicate files Same", () => {
    const result = diffFiles({ left: { "f.yaml": file("1", "2") }, right: { "f.yaml": file("1", "2") } })
    expect(hasDifferences(result)).toBe(false)
  })
})
