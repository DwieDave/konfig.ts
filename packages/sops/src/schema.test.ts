import { Effect, Exit, Schema } from "effect"
import * as fc from "fast-check"
import { describe, it } from "vitest"
import type { SopsRecipients } from "./crd"
import { SopsRecipientsSchema } from "./schema"

const decode = (value: SopsRecipients) => Effect.runSyncExit(Schema.decodeEffect(SopsRecipientsSchema)(value))

const hex = (min: number, max: number) => fc.stringMatching(new RegExp(`^[0-9a-f]{${min},${max}}$`))

const partition = fc.constantFrom("aws", "aws-cn", "aws-us-gov", "aws-iso", "aws-iso-b")

const keyId = fc.oneof(
  hex(8, 32).map((h) => `key/${h}-12ab-34cd`),
  hex(8, 32).map((h) => `key/mrk-${h}`),
  fc.stringMatching(/^[A-Za-z0-9_-]{1,20}$/).map((n) => `alias/${n}`)
)

const arn = fc.tuple(partition, keyId).map(([p, k]) => `arn:${p}:kms:us-gov-west-1:123456789012:${k}`)

const azureUrl = fc.tuple(
  fc.constantFrom("azure.net", "azure.cn", "usgovcloudapi.net", "microsoftazure.de"),
  fc.stringMatching(/^[a-z0-9]{1,12}$/)
).map(([suffix, v]) => `https://${v}.vault.${suffix}/keys/k/abc123`)

describe("SopsRecipients", () => {
  it("accepts KMS ARNs of every partition and key id form", () => {
    fc.assert(fc.property(arn, (a) => Exit.isSuccess(decode({ kms: [a] }))))
  })

  it("accepts Azure Key Vault URLs of every cloud", () => {
    fc.assert(fc.property(azureUrl, (u) => Exit.isSuccess(decode({ azureKv: [u] }))))
  })

  it("rejects recipients containing separators, whitespace or shell metachars", () => {
    const bad = fc.constantFrom(..." ,;&|$`'\"\\<>()\t\n".split(""))
    fc.assert(fc.property(arn, bad, fc.nat(20), (a, c, i) => {
      const at = i % a.length
      const mutated = `${a.slice(0, at)}${c}${a.slice(at)}`

      return Exit.isFailure(decode({ kms: [mutated] }))
    }))
  })
})
