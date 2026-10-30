import { Effect, Exit, Schema } from "effect"
import * as fc from "fast-check"
import { describe, it } from "vitest"
import { type SopsRecipients, SopsRecipientsSchema } from "./schema"

const decode = (value: SopsRecipients) => Effect.runSyncExit(Schema.decodeEffect(SopsRecipientsSchema)(value))

const hex = (min: number, max: number) => fc.stringMatching(new RegExp(`^[0-9a-f]{${min},${max}}$`))

const partition = fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { maxLength: 3 }).map((parts) =>
  ["aws", ...parts].join("-")
)

const keyId = fc.oneof(
  hex(8, 32).map((h) => `key/${h}-12ab-34cd`),
  hex(8, 32).map((h) => `key/mrk-${h}`),
  fc.stringMatching(/^[A-Za-z0-9_-]{1,20}$/).map((n) => `alias/${n}`)
)

const region = fc.stringMatching(/^[a-z]{2,6}(-[a-z]{2,8}){1,2}-[0-9]$/)

const account = fc.stringMatching(/^[0-9]{12}$/)

const arn = fc.tuple(partition, region, account, keyId).map(([p, r, a, k]) => `arn:${p}:kms:${r}:${a}:${k}`)

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
