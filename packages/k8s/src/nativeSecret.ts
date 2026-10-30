import { Manifest } from "@konfig.ts/core"
import { Effect } from "effect"
import type { Secret as K8sSecret } from "./.generated/k8s-types"
import { type EmitInput, plainSecret, resolvePlaintext, SecretBackend } from "./backend"

export interface NativeSecretOptions {
  readonly type?: string
  readonly immutable?: boolean
  readonly silenceWarning?: boolean
}

const _TAG = "NativeSecret"

const _warn = <N extends string, K extends string>(
  input: EmitInput<N, K, NativeSecretOptions>
) =>
  input.opts.silenceWarning === true
    ? Effect.void
    : Effect.logWarning(
      `NativeSecret backend emits a plaintext Secret with stringData on disk for "${input.base.namespace}/${input.base.name}". Pass { silenceWarning: true } to suppress, or switch to ExternalSecrets / SealedSecrets / Sops for production.`
    )

const _emit = <N extends string, K extends string>(
  input: EmitInput<N, K, NativeSecretOptions> & { readonly label: string }
): Manifest.Manifest<K8sSecret> =>
  Manifest.make<K8sSecret>((_ctx) =>
    Effect.gen(function*() {
      yield* _warn(input)

      const stringData = yield* resolvePlaintext({
        base: input.base,
        label: input.label
      })

      return plainSecret({ base: input.base, type: input.opts.type, stringData, immutable: input.opts.immutable })
    })
  )

export const NativeSecret = {
  backend: <N extends string, K extends string>(
    opts?: NativeSecretOptions
  ): SecretBackend<N, K, true, K8sSecret> => {
    const resolvedOpts = opts ?? {}

    return SecretBackend.make<N, K, true, K8sSecret>({
      tag: _TAG,
      requiresSource: true,
      emit: ({ base, label }) => _emit({ base, label, opts: resolvedOpts })
    })
  }
}
