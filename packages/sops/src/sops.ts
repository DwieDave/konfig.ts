import { boundary, processDetail, runProcessString } from "@konfig.ts/core"
import { Data, Effect, Stream } from "effect"
import { ChildProcess } from "effect/process"
import type { SopsRecipients } from "./crd"
import { SopsRecipientsSchema } from "./schema"

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

const _recipientArgs = (recipients: SopsRecipients): string[] =>
  _RECIPIENT_FLAGS.flatMap(([field, flag]) => {
    const values = recipients[field]

    return values !== undefined && values.length > 0 ? [flag, values.join(",")] : []
  })

export interface SopsDecryptInput {
  readonly file: string
}

export const sopsDecrypt = (input: SopsDecryptInput) =>
  Effect.gen(function*() {
    const cmd = ChildProcess.make("sops", ["--decrypt", input.file])

    return yield* runProcessString(cmd).pipe(
      Effect.mapError((cause) => new SopsInvocationError({ op: "decrypt", cause }))
    )
  }).pipe(Effect.scoped)

export interface SopsEncryptStdinInput {
  readonly plaintextYaml: string
  readonly recipients: SopsRecipients
  readonly encryptedRegex?: string | undefined
}

const DEFAULT_ENCRYPTED_REGEX = "^(data|stringData)$"

export const sopsEncryptStdin = (input: SopsEncryptStdinInput) =>
  Effect.gen(function*() {
    // Validate here too: this is public API and callers may pass unvalidated string[]
    // regardless of the SopsRecipients type, bypassing any decode a caller performed upstream.
    const recipients = yield* _decodeRecipients(input.recipients)
    const encoded = new TextEncoder().encode(input.plaintextYaml)

    const args = [
      "--config",
      "/dev/null",
      "--encrypt",
      "--input-type",
      "yaml",
      "--output-type",
      "yaml",
      "--encrypted-regex",
      input.encryptedRegex ?? DEFAULT_ENCRYPTED_REGEX,
      ..._recipientArgs(recipients),
      "/dev/stdin"
    ]

    const cmd = ChildProcess.make("sops", args, {
      stdin: Stream.succeed<Uint8Array>(encoded)
    })

    return yield* runProcessString(cmd).pipe(
      Effect.mapError((cause) => new SopsInvocationError({ op: "encrypt", cause }))
    )
  }).pipe(Effect.scoped)
