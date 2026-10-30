import { Manifest, RenderError } from "@konfig.ts/core"
import { Backend } from "@konfig.ts/k8s"
import { Effect } from "effect"
import type {
  ExternalSecret,
  ExternalSecretDataEntry,
  ExternalSecretRemoteRef,
  ExternalSecretSpec,
  ExternalSecretTarget,
  SecretStoreRef
} from "./crd"
import { type GoDuration, InvalidRefreshIntervalError, isGoDuration } from "./duration"

interface ExternalSecretsBackendOptions<K extends string = string> {
  readonly secretStoreRef: SecretStoreRef
  readonly refreshInterval?: GoDuration
  readonly remoteRef?: (key: K) => ExternalSecretRemoteRef
  readonly target?: Omit<ExternalSecretTarget, "name">
}

const _identityRemoteRef = <K extends string>(key: K): ExternalSecretRemoteRef => ({ key })

const _isValidInterval = (value: GoDuration | undefined): boolean => value === undefined || isGoDuration(value)

export const _esoData = <K extends string>(input: {
  readonly keys: ReadonlyArray<K>
  readonly remoteRef?: (key: K) => ExternalSecretRemoteRef
}): ReadonlyArray<ExternalSecretDataEntry> =>
  input.keys.map((key) => ({ secretKey: key, remoteRef: (input.remoteRef ?? _identityRemoteRef)(key) }))

const _esoSpec = <N extends string, K extends string>(
  { base, opts }: Omit<Backend.EmitInput<N, K, ExternalSecretsBackendOptions, false>, "label">
): ExternalSecretSpec => ({
  refreshInterval: opts.refreshInterval,
  secretStoreRef: {
    name: opts.secretStoreRef.name,
    kind: opts.secretStoreRef.kind ?? "SecretStore"
  },
  target: { ...opts.target, name: base.name },
  data: _esoData({ keys: base.keys, remoteRef: opts.remoteRef })
})

const _build = <N extends string, K extends string>(
  { base, opts }: Omit<Backend.EmitInput<N, K, ExternalSecretsBackendOptions, false>, "label">
): ExternalSecret => ({
  apiVersion: "external-secrets.io/v1",
  kind: "ExternalSecret",
  metadata: Backend.secretMeta(base),
  spec: _esoSpec({ base, opts })
})

const _emit = <N extends string, K extends string>(
  { base, label, opts }: Backend.EmitInput<N, K, ExternalSecretsBackendOptions, false>
): Manifest.Manifest<ExternalSecret> =>
  Manifest.make<ExternalSecret>(() =>
    _isValidInterval(opts.refreshInterval)
      ? Effect.succeed(_build({ base, opts }))
      : Effect.fail(
        new RenderError({
          message: `${label}: invalid refreshInterval`,
          cause: new InvalidRefreshIntervalError({ value: opts.refreshInterval })
        })
      )
  )

export const ExternalSecrets = {
  backend: Backend.define({ tag: "ExternalSecrets", requiresSource: false, emit: _emit })
}
