import { objectMetaSchema, stringRecordSchema as _stringRecord } from "@konfig.ts/core"
import { Schema } from "effect"

const SealedSecretTemplateSchema = Schema.Struct({
  metadata: Schema.optionalKey(
    Schema.Struct({
      name: Schema.optionalKey(Schema.String),
      namespace: Schema.optionalKey(Schema.String),
      labels: Schema.optionalKey(_stringRecord),
      annotations: Schema.optionalKey(_stringRecord)
    })
  ),
  type: Schema.optionalKey(Schema.String),
  immutable: Schema.optionalKey(Schema.Boolean)
})

const SealedSecretSpecSchema = Schema.Struct({
  template: Schema.optionalKey(SealedSecretTemplateSchema),
  encryptedData: _stringRecord
})

export const SealedSecretSchema = Schema.Struct({
  apiVersion: Schema.Literal("bitnami.com/v1alpha1"),
  kind: Schema.Literal("SealedSecret"),
  metadata: objectMetaSchema,
  spec: SealedSecretSpecSchema
})

export type SealedSecretScope = "strict" | "namespace-wide" | "cluster-wide"

