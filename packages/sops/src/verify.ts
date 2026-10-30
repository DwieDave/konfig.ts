import { boundary, type BoundaryDecodeError, parseYamlWith, RenderError } from "@konfig.ts/core"
import { Array as Arr, Data, Effect, Option, Schema } from "effect"
import type { SopsSecret } from "./crd"
import { compilePolicy, mustEncrypt } from "./encryption-policy"
import { SopsEncryptedSecretSchema } from "./schema"

const _decodeSopsSecret = boundary({
  schema: SopsEncryptedSecretSchema,
  label: "SopsSecret"
})

const _ENC_MARKER = "ENC["

class SopsUnencryptedValueError extends Data.TaggedError("SopsUnencryptedValueError")<{
  readonly label: string
  readonly key: string
}> {
  get message(): string {
    return `${this.label}: value for "${this.key}" is not sops-encrypted (missing ${_ENC_MARKER} marker)`
  }
}

const _CONTAINERS = ["stringData", "data"] as const

const _entries = (secret: SopsSecret) =>
  secret.spec.secretTemplates.flatMap((template) =>
    _CONTAINERS.flatMap((container) =>
      Object.entries(template[container] ?? {}).map(([key, value]) => ({ container, key, value }))
    )
  )

const _unencryptedFailure = (input: { readonly label: string; readonly key: string }) =>
  new RenderError({
    message:
      `${input.label}: refusing to emit — value for "${input.key}" is not sops-encrypted (missing ${_ENC_MARKER} marker)`,
    cause: new SopsUnencryptedValueError(input)
  })

export const _assertEncrypted = (
  { label, secret }: { readonly secret: SopsSecret; readonly label: string }
): Effect.Effect<void, RenderError> =>
  compilePolicy({ sops: secret.sops, label }).pipe(
    Effect.flatMap((policy) =>
      Option.match(
        Arr.findFirst(
          _entries(secret),
          ({ container, key, value }) =>
            mustEncrypt({ policy, path: ["spec", "secretTemplates", container, key] })
            && !value.startsWith(_ENC_MARKER)
        ),
        {
          onNone: () => Effect.void,
          onSome: ({ key }) => Effect.fail(_unencryptedFailure({ label, key }))
        }
      )
    )
  )

export const parseVerified = (input: {
  readonly yamlText: string
  readonly label: string
}): Effect.Effect<SopsSecret, RenderError | BoundaryDecodeError> =>
  parseYamlWith({
    text: input.yamlText,
    schema: Schema.Unknown,
    onError: (cause) => new RenderError({ message: `${input.label}: output was not valid YAML`, cause })
  }).pipe(
    Effect.flatMap(_decodeSopsSecret),
    Effect.tap((decoded) => _assertEncrypted({ secret: decoded, label: input.label }))
  )
