import { Manifest, RenderError, Yaml } from "@konfig.ts/core"
import { type BackendEmitInput, type SecretBackend } from "@konfig.ts/k8s"
import { Effect, Redacted } from "effect"
import type { SealedSecret, SealedSecretScope } from "./crd"
import { resolveCertPath, runKubeseal } from "./kubeseal"

export interface SealedSecretsBackendOptions {
  readonly scope?: SealedSecretScope
  readonly certPath?: string
}

interface _EmitInput<N extends string, K extends string> {
  readonly base: BackendEmitInput<N, K, true>
  readonly opts: SealedSecretsBackendOptions
}

const _toStringData = (
  keys: ReadonlyArray<string>,
  resolved: Record<string, Redacted.Redacted<string>>
): Record<string, string> =>
  Object.fromEntries(keys.map((key) => [key, Redacted.value(resolved[key])]))

const _toRenderError = (base: { readonly namespace: string; readonly name: string }, detail: string) =>
(cause: unknown) =>
  new RenderError({
    message: `SealedSecrets(${base.namespace}/${base.name}): ${detail}`,
    cause
  })

const _emit = <N extends string, K extends string>(
  input: _EmitInput<N, K>
): Manifest.Manifest<SealedSecret> =>
  Manifest.make<SealedSecret>((_ctx) =>
    Effect.gen(function*() {
      const certPath = yield* resolveCertPath({ certPath: input.opts.certPath }).pipe(
        Effect.mapError(_toRenderError(input.base, "cert missing"))
      )
      const resolved = yield* input.base.source.resolve.pipe(
        Effect.mapError(
          (cause) =>
            new RenderError({
              message:
                `SealedSecrets(${input.base.namespace}/${input.base.name}): source failed for key "${cause.key}"`,
              cause
            })
        )
      )
      const stringData = _toStringData(input.base.keys, resolved)
      const plainSecret = {
        apiVersion: "v1" as const,
        kind: "Secret" as const,
        metadata: {
          name: input.base.name,
          namespace: input.base.namespace
        },
        type: "Opaque" as const,
        stringData
      }
      const plainSecretYaml = Yaml.serialize({ value: plainSecret })
      return yield* runKubeseal({
        plainSecretYaml,
        certPath,
        scope: input.opts.scope ?? "strict"
      }).pipe(
        Effect.mapError(_toRenderError(input.base, "kubeseal failed"))
      )
    })
  )

export const SealedSecrets = {
  backend: <N extends string, K extends string>(
    opts?: SealedSecretsBackendOptions
  ): SecretBackend<N, K, true, SealedSecret> => {
    const resolvedOpts = opts ?? {}
    return {
      _tag: "SealedSecrets",
      requiresSource: true,
      emit: (input: BackendEmitInput<N, K, true>) => _emit({ base: input, opts: resolvedOpts })
    }
  }
}
