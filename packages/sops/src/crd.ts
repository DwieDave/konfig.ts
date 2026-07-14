import type { SopsEncryptedSecretSchema, SopsRecipientsSchema, SopsSecretSpecSchema, SopsSecretTemplateSchema } from "./schema"

export type SopsSecretTemplate = typeof SopsSecretTemplateSchema.Type
export type SopsSecretSpec = typeof SopsSecretSpecSchema.Type
export type SopsSecret = typeof SopsEncryptedSecretSchema.Type
export type SopsRecipients = typeof SopsRecipientsSchema.Type
