import { Redacted } from "effect"
import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { toObjectMeta } from "./meta"
import { hashSecretValues } from "./podHash"
import { ConfigMapRef, SecretRef } from "./refs"
import { _reloaderAnnotations, type ReloaderOption } from "./reloader"

const stringMap = fc.dictionary(fc.string({ minLength: 1 }), fc.string())
const names = fc.array(fc.string({ minLength: 1 }), { maxLength: 4 })
const secretRefs = names.map((list) => list.map((n) => SecretRef.of(n)))
const configMapRefs = names.map((list) => list.map((n) => ConfigMapRef.of(n)))

const reloaderOption: fc.Arbitrary<ReloaderOption | undefined> = fc.oneof(
  fc.constantFrom<ReloaderOption | undefined>(undefined, "off", "stakater"),
  fc.record({
    secrets: fc.option(secretRefs, { nil: undefined }),
    configMaps: fc.option(configMapRefs, { nil: undefined })
  })
)

describe("hashSecretValues properties", () => {
  const entries = fc.uniqueArray(fc.tuple(fc.string({ minLength: 1 }), fc.string()), {
    selector: ([key]) => key,
    maxLength: 6
  })

  const toValues = (pairs: ReadonlyArray<readonly [string, string]>) =>
    Object.fromEntries(pairs.map(([key, value]) => [key, Redacted.make(value)]))

  it("is invariant under key insertion order", () => {
    fc.assert(
      fc.property(entries, fc.string(), (pairs, salt) => {
        const forward = hashSecretValues({ values: toValues(pairs), salt })
        const backward = hashSecretValues({ values: toValues([...pairs].reverse()), salt })
        expect(forward).toBe(backward)
      })
    )
  })

  it("changes when a value changes", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.string(), (a, b, salt) => {
        fc.pre(a !== b)
        const hash = (value: string) => hashSecretValues({ values: { k: Redacted.make(value) }, salt })
        expect(hash(a)).not.toBe(hash(b))
      })
    )
  })
})

describe("_reloaderAnnotations properties", () => {
  it("only emits reloader.stakater.com annotation keys", () => {
    fc.assert(
      fc.property(reloaderOption, (opt) => {
        for (const key of Object.keys(_reloaderAnnotations(opt))) {
          expect(key).toMatch(/reloader\.stakater\.com\//)
        }
      })
    )
  })

  it("joins explicit secrets and configMaps with commas, omitting empty lists", () => {
    fc.assert(
      fc.property(secretRefs, configMapRefs, (secrets, configMaps) => {
        const out = _reloaderAnnotations({ secrets, configMaps })
        expect(out["secret.reloader.stakater.com/reload"]).toBe(secrets.length > 0 ? secrets.join(",") : undefined)
        expect(out["configmap.reloader.stakater.com/reload"]).toBe(
          configMaps.length > 0 ? configMaps.join(",") : undefined
        )
      })
    )
  })

  it("is empty for undefined and off", () => {
    expect(_reloaderAnnotations(undefined)).toEqual({})
    expect(_reloaderAnnotations("off")).toEqual({})
  })
})

describe("toObjectMeta properties", () => {
  const input = fc.record({
    name: fc.string({ minLength: 1 }),
    namespace: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
    labels: fc.option(stringMap, { nil: undefined }),
    annotations: fc.option(stringMap, { nil: undefined })
  })

  it("preserves name, labels and annotations", () => {
    fc.assert(
      fc.property(input, (value) => {
        const out = toObjectMeta(value)
        expect(out.name).toBe(value.name)
        expect(out.labels).toEqual(value.labels)
        expect(out.annotations).toEqual(value.annotations)
      })
    )
  })

  it("includes namespace only when provided", () => {
    fc.assert(
      fc.property(input, (value) => {
        const out = toObjectMeta(value)
        expect("namespace" in out).toBe(value.namespace !== undefined)
      })
    )
  })

  it("copies maps instead of aliasing them", () => {
    fc.assert(
      fc.property(stringMap, (labels) => {
        expect(toObjectMeta({ name: "n", labels }).labels).not.toBe(labels)
      })
    )
  })
})
