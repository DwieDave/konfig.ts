import { type BoundaryDecodeError, boundary, Manifest, RenderError, Yaml } from "@konfig.ts/core"
import { type BackendEmitInput, type SecretBackend } from "@konfig.ts/k8s"
import { Effect, Redacted } from "effect"
import { FileSystem } from "effect/FileSystem"
import * as YAML from "yaml"
import type { SopsRecipients, SopsSecret } from "./crd"
import { SopsEncryptedSecretSchema, SopsRecipientsSchema } from "./schema"
import { SopsSource } from "./source"
import { sopsEncryptStdin, SopsInvocationError } from "./sops"

const _decodeSopsSecret = boundary({
  schema: SopsEncryptedSecretSchema,
  label: "SopsSecret"
})

// Fail-closed: every value we hand to the operator MUST be a sops ciphertext,
// which is always wrapped as `ENC[AES256_GCM,data:...]` — UNLESS the document
// was partially encrypted via `encrypted_regex`, in which case only keys the
// regex selects carry ciphertext and the rest are intentionally plaintext.
// sops semantics: a matching key encrypts its whole subtree, so a value needs
// ENC[ if the regex matches its own key OR any ancestor key on the path
// (spec / secretTemplates / stringData / data). No `encrypted_regex` in the
// sops block → everything must be encrypted, as before.
const _ENC_MARKER = "ENC["

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

// ponytail: encrypted_regex only; add encrypted_suffix/unencrypted_* if a repo ever uses them
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
            return yield* new RenderError({
              message:
                `${label}: refusing to emit — value for "${key}" is not sops-encrypted (missing ${_ENC_MARKER} marker)`,
              cause: new SopsInvocationError({
                op: "encrypt",
                cause: "sops output value was not encrypted"
              })
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

// Parse → schema-decode → MAC/ciphertext-assert. Shared by _emit (sops's own
// stdout) and _passthrough (a file already on disk) — both need the same
// fail-closed pipeline before the result can be treated as a SopsSecret.
const _parseVerified = (
  yamlText: string,
  label: string
): Effect.Effect<SopsSecret, RenderError | BoundaryDecodeError> =>
  Effect.gen(function*() {
    const parsed = yield* Effect.try({
      try: (): unknown => YAML.parse(yamlText),
      catch: (cause) =>
        new RenderError({ message: `${label}: output was not valid YAML`, cause })
    })
    const decoded = yield* _decodeSopsSecret(parsed)
    yield* _assertEncrypted(decoded, label)
    return decoded
  })

// A restamp is only safe when the namespace isn't covered by the sops MAC
// (mac_only_encrypted) — otherwise metadata.namespace is exactly what
// verification is meant to protect. Rewriting to the same namespace the file
// already carries is always a no-op and needs no such guarantee.
const _restampNamespace = (
  decoded: SopsSecret,
  namespace: string,
  label: string
): Effect.Effect<SopsSecret, RenderError> => {
  if (decoded.metadata.namespace === namespace) return Effect.succeed(decoded)
  if (decoded.sops.mac_only_encrypted !== true) {
    return Effect.fail(
      new RenderError({
        message:
          `${label}: refusing to restamp metadata.namespace to "${namespace}" — file is fully MAC'd (mac_only_encrypted is not true), so the namespace is protected by the MAC`
      })
    )
  }
  return Effect.succeed({
    ...decoded,
    metadata: { ...decoded.metadata, namespace }
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
      return yield* _restampNamespace(decoded, input.base.namespace, label)
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
