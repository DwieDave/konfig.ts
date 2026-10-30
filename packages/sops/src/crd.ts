import type { SopsEncryptedSecretSchema, SopsRecipientsSchema } from "./schema"

export type SopsSecret = typeof SopsEncryptedSecretSchema.Type

export type SopsRecipients = typeof SopsRecipientsSchema.Type
