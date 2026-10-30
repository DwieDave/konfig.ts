import { boundary, RenderError, runProcessWithStdin } from "@konfig.ts/core"
import { type Duration, Effect } from "effect"
import { ChildProcess } from "effect/process"
import type { SopsRecipients } from "./crd"
import { SopsRecipientsSchema } from "./schema"

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

export const sopsEncrypt = (input: {
  readonly plainYaml: string
  readonly recipients: SopsRecipients
  readonly encryptedRegex?: string | undefined
  readonly timeout?: Duration.Input | undefined
  readonly label: string
}) =>
  _decodeRecipients(input.recipients).pipe(
    Effect.flatMap((recipients) =>
      runProcessWithStdin({
        command: ChildProcess.make("sops", _sopsArgs({ recipients, encryptedRegex: input.encryptedRegex })),
        stdin: input.plainYaml,
        label: `${input.label}: sops --encrypt`,
        timeout: input.timeout
      })
    ),
    Effect.catchTag("ProcessInvocationError", (cause) =>
      Effect.fail(new RenderError({ message: `${input.label}: sops --encrypt failed`, cause })))
  )
