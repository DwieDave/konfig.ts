import { Effect, Exit } from "effect"
import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { _assertCoversKeys, _assertSingleTemplate, _restampIdentity } from "./passthrough"
import type { SopsSecret } from "./schema"
import { _assertEncrypted } from "./verify"

const ident = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/)
const key = fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,8}$/)

const secret = (input: {
  readonly name: string
  readonly namespace: string
  readonly stringData: Record<string, string>
  readonly macOnly?: boolean
}): SopsSecret => ({
  apiVersion: "isindir.github.com/v1alpha3",
  kind: "SopsSecret",
  metadata: { name: input.name, namespace: input.namespace },
  spec: { secretTemplates: [{ name: input.name, stringData: input.stringData }] },
  sops: input.macOnly === undefined ? {} : { mac_only_encrypted: input.macOnly }
})

const identityInput = fc.record({ name: ident, namespace: ident })

describe("_assertEncrypted properties", () => {
  it("accepts records whose values all carry the ENC[ marker", () => {
    fc.assert(
      fc.property(fc.dictionary(key, fc.string().map((s) => `ENC[${s}`)), (stringData) => {
        const exit = Effect.runSyncExit(
          _assertEncrypted({ secret: secret({ name: "a", namespace: "b", stringData }), label: "L" })
        )

        expect(Exit.isSuccess(exit)).toBe(true)
      })
    )
  })

  it("rejects any record containing a value without the marker", () => {
    fc.assert(
      fc.property(key, fc.string().filter((s) => !s.startsWith("ENC[")), (k, plain) => {
        const exit = Effect.runSyncExit(
          _assertEncrypted({ secret: secret({ name: "a", namespace: "b", stringData: { [k]: plain } }), label: "L" })
        )

        expect(Exit.isFailure(exit)).toBe(true)
      })
    )
  })
})

describe("_restampIdentity properties", () => {
  const run = (decoded: SopsSecret, target: { name: string; namespace: string }) =>
    Effect.runSyncExit(_restampIdentity({ decoded, ...target, label: "L" }))

  it("is idempotent when mac_only_encrypted", () => {
    fc.assert(
      fc.property(identityInput, identityInput, (from, to) => {
        const decoded = secret({ ...from, stringData: { k: "ENC[x" }, macOnly: true })
        const once = run(decoded, to)
        expect(Exit.isSuccess(once)).toBe(true)

        if (!Exit.isSuccess(once)) return
        const twice = run(once.value, to)
        expect(Exit.isSuccess(twice) && twice.value).toEqual(once.value)
        expect(once.value.metadata).toMatchObject(to)
        expect(once.value.spec.secretTemplates.every((t) => t.name === to.name)).toBe(true)
      })
    )
  })

  it("is the identity when nothing mismatches, regardless of MAC mode", () => {
    fc.assert(
      fc.property(identityInput, fc.option(fc.boolean(), { nil: undefined }), (id, macOnly) => {
        const decoded = secret({ ...id, stringData: { k: "ENC[x" }, macOnly })
        const out = run(decoded, id)
        expect(Exit.isSuccess(out) && out.value).toEqual(decoded)
      })
    )
  })

  it("refuses to restamp fully MAC'd files with a mismatch", () => {
    fc.assert(
      fc.property(identityInput, identityInput, (from, to) => {
        fc.pre(from.name !== to.name || from.namespace !== to.namespace)
        const out = run(secret({ ...from, stringData: {}, macOnly: false }), to)
        expect(Exit.isFailure(out)).toBe(true)
        expect(JSON.stringify(out)).toContain("refusing to restamp")
      })
    )
  })
})

describe("_assertCoversKeys properties", () => {
  const run = (stringData: Record<string, string>, keys: ReadonlyArray<string>) =>
    Effect.runSyncExit(
      _assertCoversKeys({ decoded: secret({ name: "a", namespace: "b", stringData }), keys, label: "L" })
    )

  it("accepts any subset of the keys present in the file", () => {
    fc.assert(
      fc.property(
        fc.dictionary(key, fc.constant("ENC[x"), { minKeys: 1 }).chain((stringData) =>
          fc.tuple(fc.constant(stringData), fc.subarray(Object.keys(stringData)))
        ),
        ([stringData, keys]) => {
          expect(Exit.isSuccess(run(stringData, keys))).toBe(true)
        }
      )
    )
  })

  it("rejects and names every required key absent from the file", () => {
    fc.assert(
      fc.property(fc.dictionary(key, fc.constant("ENC[x")), key, (stringData, extra) => {
        const missing = `${extra}_missing`
        const out = run(stringData, [...Object.keys(stringData), missing])
        expect(Exit.isFailure(out)).toBe(true)
        expect(JSON.stringify(out)).toContain(missing)
      })
    )
  })
})

describe("_assertSingleTemplate properties", () => {
  const withTemplates = (names: ReadonlyArray<string>): SopsSecret => ({
    ...secret({ name: "a", namespace: "b", stringData: {} }),
    spec: { secretTemplates: names.map((name) => ({ name, stringData: {} })) }
  })

  it("accepts at most one template and rejects any more", () => {
    fc.assert(
      fc.property(fc.array(ident, { maxLength: 5 }), (names) => {
        const exit = Effect.runSyncExit(_assertSingleTemplate({ decoded: withTemplates(names), label: "L" }))
        expect(Exit.isSuccess(exit)).toBe(names.length <= 1)
      })
    )
  })
})

describe("_restampIdentity label and annotation merging", () => {
  const record = fc.dictionary(key, ident)

  const run = (input: { readonly macOnly: boolean; readonly labels: Record<string, string> }) =>
    Effect.runSyncExit(
      _restampIdentity({
        decoded: secret({ name: "a", namespace: "b", stringData: {}, macOnly: input.macOnly }),
        name: "a",
        namespace: "b",
        labels: input.labels,
        label: "L"
      })
    )

  it("merges bound labels into metadata when mac_only_encrypted", () => {
    fc.assert(
      fc.property(record, (labels) => {
        const out = run({ macOnly: true, labels })
        expect(Exit.isSuccess(out) && out.value.metadata.labels).toEqual(
          Object.keys(labels).length === 0 ? undefined : labels
        )
      })
    )
  })

  it("refuses to merge differing labels into a fully MAC'd file", () => {
    fc.assert(
      fc.property(record.filter((labels) => Object.keys(labels).length > 0), (labels) => {
        const out = run({ macOnly: false, labels })
        expect(Exit.isFailure(out)).toBe(true)
        expect(JSON.stringify(out)).toContain("metadata.labels")
      })
    )
  })

  it("merges bound annotations into metadata when mac_only_encrypted", () => {
    fc.assert(
      fc.property(record.filter((a) => Object.keys(a).length > 0), (annotations) => {
        const out = Effect.runSyncExit(
          _restampIdentity({
            decoded: secret({ name: "a", namespace: "b", stringData: {}, macOnly: true }),
            name: "a",
            namespace: "b",
            annotations,
            label: "L"
          })
        )

        expect(Exit.isSuccess(out) && out.value.metadata.annotations).toEqual(annotations)
      })
    )
  })
})
