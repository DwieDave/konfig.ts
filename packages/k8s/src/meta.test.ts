import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { nonEmpty, toLabelsMeta, toObjectMeta } from "./meta"

const map = fc.option(fc.dictionary(fc.string(), fc.string()), { nil: undefined })

describe("toObjectMeta", () => {
  it("copies fields without aliasing and omits absent namespace", () => {
    fc.assert(fc.property(fc.string(), map, map, (name, labels, annotations) => {
      const out = toObjectMeta({ name, labels, annotations })
      expect(out).toEqual({ name, labels, annotations })
      expect("namespace" in out).toBe(false)

      if (labels !== undefined) expect(out.labels).not.toBe(labels)
    }))
  })

  it("preserves a present namespace and does not alias maps", () => {
    fc.assert(fc.property(fc.string(), fc.string(), map, map, (name, namespace, labels, annotations) => {
      const out = toObjectMeta({ name, namespace, labels, annotations })
      expect(out).toEqual({ name, namespace, labels, annotations })

      if (labels !== undefined) expect(out.labels).not.toBe(labels)

      if (annotations !== undefined) expect(out.annotations).not.toBe(annotations)
    }))
  })
})

describe("toLabelsMeta", () => {
  it("maps undefined to undefined", () => {
    expect(toLabelsMeta(undefined)).toBeUndefined()
  })

  it("copies maps and keeps absent maps undefined", () => {
    fc.assert(fc.property(map, map, (labels, annotations) => {
      const out = toLabelsMeta({ labels, annotations })
      expect(out).toEqual({ labels, annotations })

      if (labels !== undefined) expect(out?.labels).not.toBe(labels)

      if (annotations !== undefined) expect(out?.annotations).not.toBe(annotations)
    }))
  })
})

describe("nonEmpty", () => {
  it("is undefined for an empty map and the map itself otherwise", () => {
    fc.assert(fc.property(fc.dictionary(fc.string(), fc.string()), (m) => {
      expect(nonEmpty(m)).toBe(Object.keys(m).length === 0 ? undefined : m)
    }))
  })
})
