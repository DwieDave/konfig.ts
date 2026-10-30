import { boundary, type BoundaryDecodeError, Manifest, RenderError, Yaml } from "@konfig.ts/core"
import {
  type BackendEmitInput,
  type EmitInput,
  parseYamlWith,
  resolvePlaintext,
  type SecretBackend
} from "@konfig.ts/k8s"
import { Data, Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import type { SopsRecipients, SopsSecret } from "./crd"
import { compilePolicy, mustEncrypt } from "./encryption-policy"
import { SopsEncryptedSecretSchema } from "./schema"
import { sopsEncryptStdin } from "./sops"
import { SopsSource } from "./source"

const _decodeSopsSecret = boundary({
  schema: SopsEncryptedSecretSchema,
  label: "SopsSecret"
})

// Fail-closed: every value must carry the sops ENC[ ciphertext marker, unless the
// recorded partial-encryption rules (see encryption-policy.ts) exempt it.
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

const _assertEncrypted = (
  secret: SopsSecret,
  label: string
): Effect.Effect<void, RenderError> =>
  Effect.gen(function*() {
    const policy = yield* compilePolicy({ sops: secret.sops, label })
    for (const template of secret.spec.secretTemplates) {
      for (const [container, record] of [["stringData", template.stringData], ["data", template.data]] as const) {
        if (record === undefined) continue
        for (const [key, value] of Object.entries(record)) {
          const path = ["spec", "secretTemplates", container, key]
          if (mustEncrypt({ policy, path }) && !value.startsWith(_ENC_MARKER)) {
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

// Shared fail-closed pipeline for _emit and _passthrough: parse → schema-decode → MAC/ciphertext-assert.
const _parseVerified = (
  yamlText: string,
  label: string
): Effect.Effect<SopsSecret, RenderError | BoundaryDecodeError> =>
  Effect.gen(function*() {
    const parsed = yield* parseYamlWith({
      text: yamlText,
      onError: (cause) => new RenderError({ message: `${label}: output was not valid YAML`, cause })
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
  readonly encryptedRegex?: string
}

const _plainCR = <N extends string, K extends string>(
  input: EmitInput<N, K, SopsBackendOptions>,
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
  input: EmitInput<N, K, SopsBackendOptions>
): Manifest.Manifest<SopsSecret> =>
  Manifest.make<SopsSecret>((_ctx) =>
    Effect.gen(function*() {
      const label = `Sops(${input.base.namespace}/${input.base.name})`
      const stringData = yield* resolvePlaintext({ base: input.base, label })
      const yaml = Yaml.serialize({ value: _plainCR(input, stringData) })
      const encryptedYaml = yield* sopsEncryptStdin({
        plaintextYaml: yaml,
        recipients: input.opts.recipients,
        encryptedRegex: input.opts.encryptedRegex
      }).pipe(
        Effect.catchTag("SopsInvocationError", (cause) =>
          Effect.fail(
            new RenderError({
              message: `${label}: sops --encrypt failed`,
              cause
            })
          ))
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
