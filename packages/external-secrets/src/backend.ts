import { Manifest } from "@konfig.ts/core"
import type { BackendEmitInput, SecretBackend } from "@konfig.ts/k8s"
import type {
  ExternalSecret,
  ExternalSecretDataEntry,
  ExternalSecretRemoteRef,
  ExternalSecretTarget,
  SecretStoreRef
} from "./crd"

export interface ExternalSecretsBackendOptions<K extends string> {
  readonly secretStoreRef: SecretStoreRef
  readonly refreshInterval?: `${number}${"s" | "m" | "h"}`
  readonly remoteRef?: (key: K) => ExternalSecretRemoteRef
  readonly target?: ExternalSecretTarget
}

const _identityRemoteRef = <K extends string>(key: K): ExternalSecretRemoteRef => ({ key })

const _emit = <N extends string, K extends string>(
  base: BackendEmitInput<N, K, false>,
  opts: ExternalSecretsBackendOptions<K>
): Manifest.Manifest<ExternalSecret> =>
  Manifest.make<ExternalSecret>(() => {
    const remoteRef = opts.remoteRef ?? _identityRemoteRef
    const data: ExternalSecretDataEntry[] = base.keys.map((key) => ({
      secretKey: key,
      remoteRef: remoteRef(key)
    }))
    return {
      apiVersion: "external-secrets.io/v1",
      kind: "ExternalSecret",
      metadata: {
        name: base.name,
        namespace: base.namespace,
        labels: base.labels,
        annotations: base.annotations
      },
      spec: {
        refreshInterval: opts.refreshInterval,
        secretStoreRef: {
          name: opts.secretStoreRef.name,
          kind: opts.secretStoreRef.kind ?? "SecretStore"
        },
        target: opts.target,
        data
      }
    }
  })

export const ExternalSecrets = {
  backend: <N extends string, K extends string>(
    opts: ExternalSecretsBackendOptions<K>
  ): SecretBackend<N, K, false, ExternalSecret> => ({
    _tag: "ExternalSecrets",
    requiresSource: false,
    emit: (input) => _emit(input, opts)
  })
}
