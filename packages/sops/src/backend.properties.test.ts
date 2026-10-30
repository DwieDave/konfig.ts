import { Effect, Exit } from "effect"
import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { _assertEncrypted, _restampIdentity } from "./backend"
import type { SopsSecret } from "./crd"

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
