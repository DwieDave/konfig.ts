import {
  boundary,
  type BoundaryDecodeError,
  processDetail,
  runProcessString,
  runProcessWithStdin
} from "@konfig.ts/core"
import { Data, type Duration, Effect } from "effect"
import { ChildProcess } from "effect/process"
import type { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { type SopsRecipients, SopsRecipientsSchema } from "./schema"

export class SopsInvocationError extends Data.TaggedError("SopsInvocationError")<{
  readonly op: "decrypt" | "encrypt"
  readonly cause: unknown
}> {
  get message(): string {
    return `sops ${this.op} failed${processDetail(this.cause)}`
  }
}

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

export interface SopsDecryptInput {
  readonly file: string
}

export const sopsDecrypt = (input: SopsDecryptInput): Effect.Effect<string, SopsInvocationError, ChildProcessSpawner> =>
  runProcessString({ command: ChildProcess.make("sops", ["--decrypt", input.file]) }).pipe(
    Effect.mapError((cause) => new SopsInvocationError({ op: "decrypt", cause }))
  )

export interface SopsEncryptStdinInput {
  readonly plaintextYaml: string
  readonly recipients: SopsRecipients
  readonly encryptedRegex?: string | undefined
  readonly timeout?: Duration.Input | undefined
}

const _encrypt = (input: SopsEncryptStdinInput) =>
  runProcessWithStdin({
    command: ChildProcess.make("sops", _sopsArgs(input)),
    stdin: input.plaintextYaml,
    label: "sops",
    timeout: input.timeout
  }).pipe(Effect.mapError((error) => new SopsInvocationError({ op: "encrypt", cause: error.cause })))

export const sopsEncryptStdin = (
  input: SopsEncryptStdinInput
): Effect.Effect<string, SopsInvocationError | BoundaryDecodeError, ChildProcessSpawner> =>
  _decodeRecipients(input.recipients).pipe(Effect.flatMap((recipients) => _encrypt({ ...input, recipients })))
