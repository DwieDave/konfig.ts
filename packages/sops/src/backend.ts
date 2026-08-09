import { boundary, type BoundaryDecodeError, Manifest, RenderError, Yaml } from "@konfig.ts/core"
import { type BackendEmitInput, type SecretBackend } from "@konfig.ts/k8s"
import { Data, Effect, Redacted } from "effect"
import { FileSystem } from "effect/FileSystem"
import * as YAML from "yaml"
import type { SopsRecipients, SopsSecret } from "./crd"
import { SopsEncryptedSecretSchema, SopsRecipientsSchema } from "./schema"
import { sopsEncryptStdin } from "./sops"
import { SopsSource } from "./source"

const _decodeSopsSecret = boundary({
  schema: SopsEncryptedSecretSchema,
  label: "SopsSecret"
})

// Fail-closed: every value must carry the sops ENC[ ciphertext marker, unless
// encrypted_regex partially-encrypts (a key needs ENC[ if the regex matches
// it or any ancestor key on its path).
const _ENC_MARKER = "ENC["

// Post-hoc validation failure (sops exited 0 but the value isn't ciphertext) — distinct from
// SopsInvocationError, which is reserved for the sops process itself failing to run.
class SopsUnencryptedValueError extends Data.TaggedError("SopsUnencryptedValueError")<{
  readonly label: string
  readonly key: string
}> {
  get message(): string {
    return `${this.label}: value for "${this.key}" is not sops-encrypted (missing ${_ENC_MARKER} marker)`
  }
}

const _encryptedRegex = (
  secret: SopsSecret,
  label: string
): Effect.Effect<RegExp | undefined, RenderError> => {
  const raw = secret.sops.encrypted_regex
  if (raw === undefined) return Effect.undefined
  return Effect.try({
    try: () => new RegExp(raw),
    catch: (cause) =>
      new RenderError({
        message: `${label}: sops.encrypted_regex is not a valid regex`,
        cause
      })
  })
}

const _assertEncrypted = (
  secret: SopsSecret,
  label: string
): Effect.Effect<void, RenderError> =>
  Effect.gen(function*() {
    const regex = yield* _encryptedRegex(secret, label)
    for (const template of secret.spec.secretTemplates) {
      for (const [container, record] of [["stringData", template.stringData], ["data", template.data]] as const) {
        if (record === undefined) continue
        for (const [key, value] of Object.entries(record)) {
          const mustEncrypt = regex === undefined
            || ["spec", "secretTemplates", container, key].some((segment) => regex.test(segment))
          if (mustEncrypt && !value.startsWith(_ENC_MARKER)) {
            const unencrypted = new SopsUnencryptedValueError({ label, key })
            return yield* new RenderError({
              message:
                `${label}: refusing to emit — value for "${key}" is not sops-encrypted (missing ${_ENC_MARKER} marker)`,
              cause: unencrypted
            })
          }
        }
      }
    }
  })

const _decodeRecipients = boundary({
  schema: SopsRecipientsSchema,
  label: "SopsRecipients"
})

// Shared fail-closed pipeline for _emit and _passthrough: parse → schema-decode → MAC/ciphertext-assert.
const _parseVerified = (
  yamlText: string,
  label: string
): Effect.Effect<SopsSecret, RenderError | BoundaryDecodeError> =>
  Effect.gen(function*() {
    const parsed = yield* Effect.try({
      try: (): unknown => YAML.parse(yamlText),
      catch: (cause) => new RenderError({ message: `${label}: output was not valid YAML`, cause })
    })
    const decoded = yield* _decodeSopsSecret(parsed)
    yield* _assertEncrypted(decoded, label)
    return decoded
  })

// Restamping namespace/name is only safe when mac_only_encrypted; otherwise the MAC covers them.
const _restampIdentity = (
  decoded: SopsSecret,
  namespace: string,
  name: string,
  label: string
): Effect.Effect<SopsSecret, RenderError> => {
  const namespaceMismatch = decoded.metadata.namespace !== namespace
  const nameMismatch = decoded.metadata.name !== name
    || decoded.spec.secretTemplates.some((template) => template.name !== name)
  if (!namespaceMismatch && !nameMismatch) return Effect.succeed(decoded)

  if (decoded.sops.mac_only_encrypted !== true) {
    const targets = [
      namespaceMismatch ? `metadata.namespace to "${namespace}"` : undefined,
      nameMismatch ? `metadata.name/spec.secretTemplates[].name to "${name}"` : undefined
    ].filter((target): target is string => target !== undefined).join(" and ")
    return Effect.fail(
      new RenderError({
        message:
          `${label}: refusing to restamp ${targets} — file is fully MAC'd (mac_only_encrypted is not true), so it is protected by the MAC`
      })
    )
  }
  return Effect.succeed({
    ...decoded,
    metadata: { ...decoded.metadata, namespace, name },
    spec: {
      ...decoded.spec,
      secretTemplates: decoded.spec.secretTemplates.map((template) => ({ ...template, name }))
    }
  })
}

export interface SopsBackendOptions {
  readonly recipients: SopsRecipients
  readonly type?: string
}

interface _EmitInput<N extends string, K extends string> {
  readonly base: BackendEmitInput<N, K, true>
  readonly opts: SopsBackendOptions
}

const _plainCR = <N extends string, K extends string>(
  input: _EmitInput<N, K>,
  stringData: Record<string, string>
) => ({
  apiVersion: "isindir.github.com/v1alpha3" as const,
  kind: "SopsSecret" as const,
  metadata: {
    name: input.base.name,
    namespace: input.base.namespace,
    labels: input.base.labels,
    annotations: input.base.annotations
  },
  spec: {
    secretTemplates: [
      {
        name: input.base.name,
        type: input.opts.type ?? "Opaque",
        stringData
      }
    ]
  }
})

const _emit = <N extends string, K extends string>(
  input: _EmitInput<N, K>
): Manifest.Manifest<SopsSecret> =>
  Manifest.make<SopsSecret>((_ctx) =>
    Effect.gen(function*() {
      const label = `Sops(${input.base.namespace}/${input.base.name})`
      const resolved = yield* input.base.source.resolve.pipe(
        Effect.mapError(
          (cause) =>
            new RenderError({
              message: `${label}: source failed for key "${cause.key}"`,
              cause
            })
        )
      )
      const stringData: Record<string, string> = {}
      for (const key of input.base.keys) {
        stringData[key] = Redacted.value(resolved[key])
      }
      const yaml = Yaml.serialize({ value: _plainCR(input, stringData) })
      const recipients = yield* _decodeRecipients(input.opts.recipients)
      const encryptedYaml = yield* sopsEncryptStdin({
        plaintextYaml: yaml,
        recipients
      }).pipe(
        Effect.mapError(
          (cause) =>
            new RenderError({
              message: `${label}: sops --encrypt failed`,
              cause
            })
        )
      )
      return yield* _parseVerified(encryptedYaml, label)
    })
  )

interface _PassthroughInput<N extends string, K extends string> {
  readonly base: BackendEmitInput<N, K, false>
  readonly file: string
}

const _passthrough = <N extends string, K extends string>(
  input: _PassthroughInput<N, K>
): Manifest.Manifest<SopsSecret> =>
  Manifest.make<SopsSecret>((_ctx) =>
    Effect.gen(function*() {
      const label = `Sops.passthrough(${input.base.namespace}/${input.base.name})`
      const fs = yield* FileSystem
      const contents = yield* fs
        .readFileString(input.file)
        .pipe(
          Effect.mapError(
            (cause) =>
              new RenderError({
                message: `${label}: could not read ${input.file}`,
                cause
              })
          )
        )
      const decoded = yield* _parseVerified(contents, label)
      return yield* _restampIdentity(decoded, input.base.namespace, input.base.name, label)
    })
  )

export const Sops = {
  source: SopsSource.source,
  backend: <N extends string, K extends string>(
    opts: SopsBackendOptions
  ): SecretBackend<N, K, true, SopsSecret> => ({
    _tag: "Sops",
    requiresSource: true,
    emit: (input: BackendEmitInput<N, K, true>) => _emit({ base: input, opts })
  }),
  passthrough: <N extends string, K extends string>(opts: {
    readonly file: string
  }): SecretBackend<N, K, false, SopsSecret> => ({
    _tag: "Sops.passthrough",
    requiresSource: false,
    emit: (input: BackendEmitInput<N, K, false>) => _passthrough({ base: input, file: opts.file })
  })
}
