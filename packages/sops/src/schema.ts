import { objectMetaSchema, stringRecordSchema as _stringRecord } from "@konfig.ts/core"
import { Schema } from "effect"

// Recipients flow into `sops --<kind> a,b,c` argv; must contain no comma or shell metachar.
const _AGE_RECIPIENT = /^age1[0-9a-z]{58}$/

const _AWS_KMS_ARN =
  /^arn:aws(?:-cn|-us-gov|-iso|-iso-b)?:kms:[a-z0-9-]+:[0-9]+:(?:key\/(?:mrk-)?[0-9a-fA-F-]+|alias\/[A-Za-z0-9/_-]+)$/

const _GCP_KMS_PATH =
  /^projects\/[A-Za-z0-9-]+\/locations\/[A-Za-z0-9-]+\/keyRings\/[A-Za-z0-9_-]+\/cryptoKeys\/[A-Za-z0-9_-]+(?:\/cryptoKeyVersions\/[0-9]+)?$/

const _AZURE_KV_URL =
  /^https:\/\/[A-Za-z0-9-]+\.vault\.(?:azure\.net|azure\.cn|usgovcloudapi\.net|microsoftazure\.de)\/keys\/[A-Za-z0-9-]+\/[A-Za-z0-9]+$/

const _PGP_FINGERPRINT = /^[0-9A-Fa-f]{8,40}$/

const _recipientArray = ({ pattern, label }: { readonly pattern: RegExp; readonly label: string }) =>
  Schema.Array(
    Schema.String.check(
      Schema.isPattern(pattern, {
        description: `${label} recipient (no commas, no shell metachars)`
      })
    )
  )

export const SopsRecipientsSchema = Schema.Struct({
  age: Schema.optionalKey(_recipientArray({ pattern: _AGE_RECIPIENT, label: "age" })),
  kms: Schema.optionalKey(_recipientArray({ pattern: _AWS_KMS_ARN, label: "AWS KMS ARN" })),
  gcpKms: Schema.optionalKey(_recipientArray({ pattern: _GCP_KMS_PATH, label: "GCP KMS" })),
  azureKv: Schema.optionalKey(_recipientArray({ pattern: _AZURE_KV_URL, label: "Azure Key Vault" })),
  pgp: Schema.optionalKey(_recipientArray({ pattern: _PGP_FINGERPRINT, label: "PGP fingerprint" }))
})

const SopsSecretTemplateSchema = Schema.Struct({
  name: Schema.String,
  type: Schema.optionalKey(Schema.String),
  stringData: Schema.optionalKey(_stringRecord),
  data: Schema.optionalKey(_stringRecord),
  labels: Schema.optionalKey(_stringRecord),
  annotations: Schema.optionalKey(_stringRecord)
})

const SopsSecretSpecSchema = Schema.Struct({
  secretTemplates: Schema.Array(SopsSecretTemplateSchema),
  suspend: Schema.optionalKey(Schema.Boolean)
})

// Only fields backend.ts reads are typed; trailing Record absorbs the rest of sops's output shape.
const SopsMetadataSchema = Schema.StructWithRest(
  Schema.Struct({
    mac_only_encrypted: Schema.optionalKey(Schema.Boolean),
    encrypted_regex: Schema.optionalKey(Schema.String),
    unencrypted_regex: Schema.optionalKey(Schema.String),
    encrypted_suffix: Schema.optionalKey(Schema.String),
    unencrypted_suffix: Schema.optionalKey(Schema.String)
  }),
  [Schema.Record(Schema.String, Schema.Unknown)]
)

// Requires the top-level `sops` metadata block, so a plaintext-shaped document fails to decode.
export const SopsEncryptedSecretSchema = Schema.Struct({
  apiVersion: Schema.Literal("isindir.github.com/v1alpha3"),
  kind: Schema.Literal("SopsSecret"),
  metadata: objectMetaSchema,
  spec: SopsSecretSpecSchema,
  sops: SopsMetadataSchema
})

export type SopsSecret = typeof SopsEncryptedSecretSchema.Type

export type SopsRecipients = typeof SopsRecipientsSchema.Type
