import { Manifest, RenderError } from "@konfig.ts/core"
import { Effect, Redacted } from "effect"
import type { Secret as K8sSecret } from "./.generated/k8s-types"
import { type BackendEmitInput, type SecretBackend } from "./backend"

export interface NativeSecretOptions {
  readonly type?: string
  readonly immutable?: boolean
  readonly silenceWarning?: boolean
}

interface _EmitInput<N extends string, K extends string> {
  readonly base: BackendEmitInput<N, K, true>
  readonly opts: NativeSecretOptions
}

const _emit = <N extends string, K extends string>(
  input: _EmitInput<N, K>
): Manifest.Manifest<K8sSecret> =>
  Manifest.make<K8sSecret>((_ctx) =>
    Effect.gen(function*() {
      if (input.opts.silenceWarning !== true) {
        yield* Effect.logWarning(
          `NativeSecret backend emits a plaintext Secret with stringData on disk for "${input.base.namespace}/${input.base.name}". Pass { silenceWarning: true } to suppress, or switch to ExternalSecrets / SealedSecrets / Sops for production.`
        )
      }
      const resolved = yield* input.base.source.resolve.pipe(
        Effect.mapError(
          (cause) =>
            new RenderError({
              message: `NativeSecret(${input.base.namespace}/${input.base.name}): source failed for key "${cause.key}"`,
              cause
            })
        )
      )
      const stringData: Record<string, string> = {}
      for (const key of input.base.keys) {
        stringData[key] = Redacted.value(resolved[key])
      }
      const out: K8sSecret = {
        apiVersion: "v1",
        kind: "Secret",
        metadata: {
          name: input.base.name,
          namespace: input.base.namespace,
          labels: input.base.labels,
          annotations: input.base.annotations
        },
        type: input.opts.type,
        stringData,
        immutable: input.opts.immutable
      }
      return out
    })
  )

export const NativeSecret = {
  backend: <N extends string, K extends string>(
    opts?: NativeSecretOptions
  ): SecretBackend<N, K, true, K8sSecret> => {
    const resolvedOpts = opts ?? {}
    return {
      _tag: "NativeSecret",
      requiresSource: true,
      emit: (input: BackendEmitInput<N, K, true>) => _emit({ base: input, opts: resolvedOpts })
    }
  }
}
