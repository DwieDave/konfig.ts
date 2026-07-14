import { Manifest, RenderError, Yaml } from "@konfig.ts/core"
import type { SecretSource } from "@konfig.ts/env"
import { type BackendEmitInput, BackendSourceMissing, type SecretBackend } from "@konfig.ts/k8s"
import { Effect, Redacted } from "effect"
import type { SealedSecret, SealedSecretScope } from "./crd"
import { resolveCertPath, runKubeseal } from "./kubeseal"

export interface SealedSecretsBackendOptions {
  readonly scope?: SealedSecretScope
  readonly certPath?: string
}

interface _EmitInput<N extends string, K extends string> {
  readonly base: BackendEmitInput<N, K>
  readonly source: SecretSource<K, Manifest.RenderServices>
  readonly opts: SealedSecretsBackendOptions
}

const _emit = <N extends string, K extends string>(
  input: _EmitInput<N, K>
): Manifest.Manifest<SealedSecret> =>
  Manifest.make<SealedSecret>((_ctx) =>
    Effect.gen(function*() {
      const certPath = yield* Effect.try({
        try: () => resolveCertPath({ certPath: input.opts.certPath }),
        catch: (cause) =>
          new RenderError({
            message: `SealedSecrets(${input.base.namespace}/${input.base.name}): cert missing`,
            cause
          })
      })
      const resolved = yield* input.source.resolve.pipe(
        Effect.mapError(
          (cause) =>
            new RenderError({
              message:
                `SealedSecrets(${input.base.namespace}/${input.base.name}): source failed for key "${cause.key}"`,
              cause
            })
        )
      )
      const stringData: Record<string, string> = {}
      for (const key of input.base.keys) {
        stringData[key] = Redacted.value(resolved[key])
      }
      const plainSecret = {
        apiVersion: "v1" as const,
        kind: "Secret" as const,
        metadata: {
          name: input.base.name,
          namespace: input.base.namespace
        },
        type: "Opaque",
        stringData
      }
      const plainSecretYaml = Yaml.serialize({ value: plainSecret })
      return yield* runKubeseal({
        plainSecretYaml,
        certPath,
        scope: input.opts.scope ?? "strict"
      }).pipe(
        Effect.mapError(
          (cause) =>
            new RenderError({
              message: `SealedSecrets(${input.base.namespace}/${input.base.name}): kubeseal failed`,
              cause
            })
        )
      )
    })
  )

export const SealedSecrets = {
  backend: <N extends string, K extends string>(
    opts?: SealedSecretsBackendOptions
  ): SecretBackend<N, K, true> => {
    const resolvedOpts = opts ?? {}
    return {
      _tag: "SealedSecrets",
      requiresSource: true,
      emit: (input: BackendEmitInput<N, K>) => {
        if (input.source === undefined) {
          throw new BackendSourceMissing({
            backend: "SealedSecrets",
            secret: input.name
          })
        }
        return _emit({ base: input, source: input.source, opts: resolvedOpts })
      }
    }
  }
}
