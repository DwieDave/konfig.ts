import { Schema } from "effect"

const _stringRecord = Schema.Record(Schema.String, Schema.String)

// All recipients flow into `sops --<kind> a,b,c` argv items. They must contain
// no comma (would silently split) and no shell metacharacter (defense in depth
// even though we use argv, not /bin/sh -c).
const _AGE_RECIPIENT = /^age1[0-9a-z]{58}$/
const _AWS_KMS_ARN = /^arn:aws:kms:[a-z0-9-]+:[0-9]+:(?:key\/[0-9a-fA-F-]+|alias\/[A-Za-z0-9/_-]+)$/
const _GCP_KMS_PATH =
  /^projects\/[A-Za-z0-9-]+\/locations\/[A-Za-z0-9-]+\/keyRings\/[A-Za-z0-9_-]+\/cryptoKeys\/[A-Za-z0-9_-]+(?:\/cryptoKeyVersions\/[0-9]+)?$/
const _AZURE_KV_URL = /^https:\/\/[A-Za-z0-9-]+\.vault\.azure\.net\/keys\/[A-Za-z0-9-]+\/[A-Za-z0-9]+$/
const _PGP_FINGERPRINT = /^[0-9A-Fa-f]{8,40}$/

const _recipientArray = (pattern: RegExp, label: string) =>
  Schema.Array(
    Schema.String.check(
      Schema.isPattern(pattern, {
        description: `${label} recipient (no commas, no shell metachars)`
      })
    )
  )

export const SopsRecipientsSchema = Schema.Struct({
  age: Schema.optionalKey(_recipientArray(_AGE_RECIPIENT, "age")),
  kms: Schema.optionalKey(_recipientArray(_AWS_KMS_ARN, "AWS KMS ARN")),
  gcpKms: Schema.optionalKey(_recipientArray(_GCP_KMS_PATH, "GCP KMS")),
  azureKv: Schema.optionalKey(_recipientArray(_AZURE_KV_URL, "Azure Key Vault")),
  pgp: Schema.optionalKey(_recipientArray(_PGP_FINGERPRINT, "PGP fingerprint"))
})

export const SopsSecretTemplateSchema = Schema.Struct({
  name: Schema.String,
  type: Schema.optionalKey(Schema.String),
  stringData: Schema.optionalKey(_stringRecord),
  data: Schema.optionalKey(_stringRecord),
  labels: Schema.optionalKey(_stringRecord),
  annotations: Schema.optionalKey(_stringRecord)
})

export const SopsSecretSpecSchema = Schema.Struct({
  secretTemplates: Schema.Array(SopsSecretTemplateSchema),
  suspend: Schema.optionalKey(Schema.Boolean)
})

// Only the fields backend.ts reads are enumerated. A real sops block also
// carries version/lastmodified/mac/pgp/kms/age/etc — the trailing Record
// keeps those untyped instead of forcing us to model sops's full output shape.
export const SopsMetadataSchema = Schema.StructWithRest(
  Schema.Struct({
    mac_only_encrypted: Schema.optionalKey(Schema.Boolean),
    encrypted_regex: Schema.optionalKey(Schema.String)
  }),
  [Schema.Record(Schema.String, Schema.Unknown)]
)

// Fail-closed decoder for anything we emit as an ENCRYPTED SopsSecret. Unlike a
// plaintext-shaped document, a genuinely sops-encrypted file ALWAYS carries the
// top-level `sops` metadata block (recipients, MAC, lastmodified, version). We
// model it as a REQUIRED, object-typed key: a plaintext SopsSecret has no such
// block, so decoding it here fails instead of being emitted as if encrypted.
// (Value-level "does it start with ENC[" is asserted separately in backend.ts.)
export const SopsEncryptedSecretSchema = Schema.Struct({
  apiVersion: Schema.Literal("isindir.github.com/v1alpha3"),
  kind: Schema.Literal("SopsSecret"),
  metadata: Schema.Struct({
    name: Schema.String,
    namespace: Schema.String,
    labels: Schema.optionalKey(_stringRecord),
    annotations: Schema.optionalKey(_stringRecord)
  }),
  spec: SopsSecretSpecSchema,
  sops: SopsMetadataSchema
})
