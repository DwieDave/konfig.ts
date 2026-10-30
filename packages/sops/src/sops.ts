import { boundary, RenderError } from "@konfig.ts/core"
import { Effect } from "effect"
import { type SopsRecipients, SopsRecipientsSchema } from "./schema"

const _decodeRecipients = boundary({
  schema: SopsRecipientsSchema,
  label: "SopsRecipients"
})

const _RECIPIENT_FLAGS: ReadonlyArray<readonly [keyof SopsRecipients, string]> = [
  ["age", "--age"],
  ["kms", "--kms"],
  ["gcpKms", "--gcp-kms"],
  ["azureKv", "--azure-kv"],
  ["pgp", "--pgp"]
]

export const _recipientArgs = (recipients: SopsRecipients): string[] =>
  _RECIPIENT_FLAGS.flatMap(([field, flag]) => {
    const values = recipients[field]

    return values !== undefined && values.length > 0 ? [flag, values.join(",")] : []
  })

const DEFAULT_ENCRYPTED_REGEX = "^(data|stringData)$"

export const _sopsArgs = (input: {
  readonly recipients: SopsRecipients
  readonly encryptedRegex?: string | undefined
}): string[] => [
  "--config",
  "/dev/null",
  "--encrypt",
  "--input-type",
  "yaml",
  "--output-type",
  "yaml",
  "--encrypted-regex",
  input.encryptedRegex ?? DEFAULT_ENCRYPTED_REGEX,
  ..._recipientArgs(input.recipients),
  "/dev/stdin"
]

export const sopsArgs = (input: {
  readonly recipients: SopsRecipients
  readonly encryptedRegex?: string | undefined
  readonly label: string
}) =>
  _decodeRecipients(input.recipients).pipe(
    Effect.mapError((cause) =>
      new RenderError({ message: `${input.label}: sops recipients did not match SopsRecipients`, cause })
    ),
    Effect.map((recipients) => _sopsArgs({ recipients, encryptedRegex: input.encryptedRegex }))
  )
