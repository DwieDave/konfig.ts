import { Manifest } from "@konfig.ts/core"
import { Data, Effect } from "effect"
import type { Secret as K8sSecret } from "./.generated/k8s-types"
import { type BackendEmitInput, type EmitInput, resolvePlaintext, type SecretBackend } from "./backend"

export interface NativeSecretOptions {
  readonly type?: string
  readonly immutable?: boolean
  readonly silenceWarning?: boolean
}

const _emit = <N extends string, K extends string>(
  input: EmitInput<N, K, NativeSecretOptions>
): Manifest.Manifest<K8sSecret> =>
  Manifest.make<K8sSecret>((_ctx) =>
    Effect.gen(function*() {
      if (input.opts.silenceWarning !== true) {
        yield* Effect.logWarning(
          `NativeSecret backend emits a plaintext Secret with stringData on disk for "${input.base.namespace}/${input.base.name}". Pass { silenceWarning: true } to suppress, or switch to ExternalSecrets / SealedSecrets / Sops for production.`
        )
      }

      const stringData = yield* resolvePlaintext({
        base: input.base,
        label: `NativeSecret(${input.base.namespace}/${input.base.name})`
      })

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

class _NativeSecretBackend<N extends string, K extends string> extends Data.TaggedClass("NativeSecret")<{
  readonly requiresSource: true
  readonly emit: SecretBackend<N, K, true, K8sSecret>["emit"]
}> {}

export const NativeSecret = {
  backend: <N extends string, K extends string>(
    opts?: NativeSecretOptions
  ): SecretBackend<N, K, true, K8sSecret> => {
    const resolvedOpts = opts ?? {}

    return new _NativeSecretBackend<N, K>({
      requiresSource: true,
      emit: (input: BackendEmitInput<N, K, true>) => _emit({ base: input, opts: resolvedOpts })
    })
  }
}
