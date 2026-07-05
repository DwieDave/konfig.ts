import { boundary, Manifest, RenderError, Yaml } from "@konfig.ts/core"
import type { SecretSource } from "@konfig.ts/env"
import { type BackendEmitInput, BackendSourceMissing, type SecretBackend } from "@konfig.ts/k8s"
// BackendSourceMissing is kept as a defensive throw — the type system now
// rejects `Sops.backend()` without `source` at compile time, but if a caller
// uses `coerce` to bypass that, runtime catches the hole.
import { Effect, Redacted } from "effect"
import { FileSystem } from "effect/FileSystem"
import * as YAML from "yaml"
import type { SopsRecipients, SopsSecret } from "./crd"
import { SopsEncryptedSecretSchema, SopsRecipientsSchema } from "./schema"
import { sopsEncryptStdin, SopsInvocationError } from "./sops"

const _decodeSopsSecret = boundary({
  schema: SopsEncryptedSecretSchema,
  label: "SopsSecret"
})

// Fail-closed: every value we hand to the operator MUST be a sops ciphertext,
// which is always wrapped as `ENC[AES256_GCM,data:...]`. If sops ever returns a
// document whose values are not so wrapped (misconfiguration, unexpected output
// shape), we refuse to emit rather than leak plaintext dressed up as a secret.
const _ENC_MARKER = "ENC["
const _assertEncrypted = (
  secret: SopsSecret,
  label: string
): Effect.Effect<void, RenderError> =>
  Effect.gen(function*() {
    for (const template of secret.spec.secretTemplates) {
      for (const record of [template.stringData, template.data]) {
        if (record === undefined) continue
        for (const [key, value] of Object.entries(record)) {
          if (!value.startsWith(_ENC_MARKER)) {
            return yield* Effect.fail(
              new RenderError({
                message:
                  `${label}: refusing to emit — value for "${key}" is not sops-encrypted (missing ${_ENC_MARKER} marker)`,
                cause: new SopsInvocationError({
                  op: "encrypt",
                  cause: "sops output value was not encrypted"
                })
              })
            )
          }
        }
      }
    }
  })

const _decodeRecipients = boundary({
  schema: SopsRecipientsSchema,
  label: "SopsRecipients"
})

export interface SopsBackendOptions {
  readonly recipients: SopsRecipients
  readonly type?: string
}

interface _EmitInput<N extends string, K extends string> {
  readonly base: BackendEmitInput<N, K>
  readonly source: SecretSource<K, Manifest.RenderServices>
  readonly opts: SopsBackendOptions
}

const _emit = <N extends string, K extends string>(
  input: _EmitInput<N, K>
): Manifest.Manifest<SopsSecret> =>
  Manifest.make<SopsSecret>((_ctx) =>
    Effect.gen(function*() {
      const resolved = yield* input.source.resolve.pipe(
        Effect.mapError(
          (cause) =>
            new RenderError({
              message: `Sops(${input.base.namespace}/${input.base.name}): source failed for key "${cause.key}"`,
              cause
            })
        )
      )
      const stringData: Record<string, string> = {}
      for (const key of input.base.keys) {
        stringData[key] = Redacted.value(resolved[key])
      }
      const plainCR = {
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
      }
      const yaml = Yaml.serialize({ value: plainCR })
      const recipients = yield* _decodeRecipients(input.opts.recipients)
      const encryptedYaml = yield* sopsEncryptStdin({
        plaintextYaml: yaml,
        recipients
      }).pipe(
        Effect.mapError(
          (cause) =>
            new RenderError({
              message: `Sops(${input.base.namespace}/${input.base.name}): sops --encrypt failed`,
              cause
            })
        )
      )
      const parsed = yield* Effect.try({
        try: (): unknown => YAML.parse(encryptedYaml),
        catch: (cause) =>
          new RenderError({
            message: `Sops(${input.base.namespace}/${input.base.name}): sops stdout was not valid YAML`,
            cause
          })
      })
      const decoded = yield* _decodeSopsSecret(parsed)
      yield* _assertEncrypted(
        decoded,
        `Sops(${input.base.namespace}/${input.base.name})`
      )
      return decoded
    })
  )

interface _PassthroughInput<N extends string, K extends string> {
  readonly base: BackendEmitInput<N, K>
  readonly file: string
}

const _passthrough = <N extends string, K extends string>(
  input: _PassthroughInput<N, K>
): Manifest.Manifest<SopsSecret> =>
  Manifest.make<SopsSecret>((_ctx) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const contents = yield* fs
        .readFileString(input.file)
        .pipe(
          Effect.mapError(
            (cause) =>
              new RenderError({
                message: `Sops.passthrough(${input.base.namespace}/${input.base.name}): could not read ${input.file}`,
                cause
              })
          )
        )
      const parsed = yield* Effect.try({
        try: (): unknown => YAML.parse(contents),
        catch: (cause) =>
          new RenderError({
            message:
              `Sops.passthrough(${input.base.namespace}/${input.base.name}): file ${input.file} was not valid YAML`,
            cause
          })
      })
      const decoded = yield* _decodeSopsSecret(parsed)
      yield* _assertEncrypted(
        decoded,
        `Sops.passthrough(${input.base.namespace}/${input.base.name})`
      )
      // Emit the SopsSecret in the namespace the bundle binds it to, not
      // the one baked into the file on disk. They coincide for every
      // fixed-namespace env (a no-op restamp); it lets a per-worktree
      // local namespace (`local-<slug>`) reuse one on-disk secret. Safe
      // only because these files are sops `mac_only_encrypted`, so
      // `metadata.namespace` is outside the MAC and the operator still
      // verifies + decrypts after the restamp.
      return {
        ...decoded,
        metadata: { ...decoded.metadata, namespace: input.base.namespace }
      }
    })
  )

import { SopsSource } from "./source"

export const Sops = {
  source: SopsSource.source,
  backend: <N extends string, K extends string>(
    opts: SopsBackendOptions
  ): SecretBackend<N, K, true> => ({
    _tag: "Sops",
    requiresSource: true,
    emit: (input: BackendEmitInput<N, K>) => {
      if (input.source === undefined) {
        throw new BackendSourceMissing({ backend: "Sops", secret: input.name })
      }
      return _emit({ base: input, source: input.source, opts })
    }
  }),
  passthrough: <N extends string, K extends string>(opts: {
    readonly file: string
  }): SecretBackend<N, K, false> => ({
    _tag: "Sops.passthrough",
    requiresSource: false,
    emit: (input: BackendEmitInput<N, K>) => _passthrough({ base: input, file: opts.file })
  })
}
