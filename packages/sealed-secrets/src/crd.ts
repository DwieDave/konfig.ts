import type {
  SealedSecretSchema,
  SealedSecretSpecSchema,
  SealedSecretTemplateSchema
} from "./schema"

export type SealedSecretScope = "strict" | "namespace-wide" | "cluster-wide"

export type SealedSecretTemplate = typeof SealedSecretTemplateSchema.Type

export type SealedSecretSpec = typeof SealedSecretSpecSchema.Type

export type SealedSecret = typeof SealedSecretSchema.Type
