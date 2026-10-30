import type { ConfigMapRef, SecretRef } from "@konfig.ts/core"
import { Manifest } from "@konfig.ts/core"
import type { ConfigMap as K8sConfigMap, Namespace as K8sNamespace, Secret as K8sSecret } from "./.generated/k8s-types"
import { copyMap, type MetaLabels, toObjectMeta } from "./meta"
import { ConfigMapRef as ConfigMapRefValue, SecretRef as SecretRefValue } from "./refs"

interface WithRefInput<A, R> {
  readonly manifest: Manifest.Manifest<A>
  readonly ref: R
}

const _withRef = <A, R>(input: WithRefInput<A, R>): Manifest.Manifest<A> & { readonly ref: R } =>
  Object.assign(input.manifest, { ref: input.ref })

export interface NamespaceInput<N extends string> extends MetaLabels {
  readonly name: N
}

export interface NamespaceManifest<N extends string> extends Manifest.Manifest<K8sNamespace> {
  readonly ref: N
}

export const Namespace = {
  make: <N extends string>(input: NamespaceInput<N>): NamespaceManifest<N> =>
    _withRef({
      manifest: Manifest.make<K8sNamespace>(() => ({
        apiVersion: "v1",
        kind: "Namespace",
        metadata: toObjectMeta(input)
      })),
      ref: input.name
    })
}

export interface ConfigMapInput<N extends string, K extends string = string> extends MetaLabels {
  readonly name: N
  readonly namespace: string
  readonly data?: Readonly<Record<K, string>>
  readonly binaryData?: Readonly<Record<K, string>>
  readonly immutable?: boolean
}

export interface ConfigMapManifest<N extends string, K extends string = string>
  extends Manifest.Manifest<K8sConfigMap>
{
  readonly ref: ConfigMapRef<N, K>
}

const _buildConfigMap = (input: ConfigMapInput<string, string>): K8sConfigMap => ({
  apiVersion: "v1",
  kind: "ConfigMap",
  metadata: toObjectMeta(input),
  data: copyMap(input.data),
  binaryData: copyMap(input.binaryData),
  immutable: input.immutable
})

export const ConfigMap = {
  make: <const N extends string, const K extends string = string>(
    input: ConfigMapInput<N, K>
  ): ConfigMapManifest<N, K> =>
    _withRef({
      manifest: Manifest.make(() => _buildConfigMap(input)),
      ref: ConfigMapRefValue.of<N, K>(input.name)
    })
}

export interface SecretInput<
  N extends string,
  Ns extends string = string,
  K extends string = string
> extends MetaLabels {
  readonly name: N
  readonly namespace: Ns
  readonly type?: string
  readonly data?: Readonly<Record<K, string>>
  readonly stringData?: Readonly<Record<K, string>>
  readonly immutable?: boolean
}

export interface SecretManifest<
  N extends string,
  Ns extends string = string,
  K extends string = string
> extends Manifest.Manifest<K8sSecret> {
  readonly ref: SecretRef<N, K, Ns>
}

const _buildSecret = (input: SecretInput<string, string, string>): K8sSecret => ({
  apiVersion: "v1",
  kind: "Secret",
  metadata: toObjectMeta(input),
  type: input.type,
  data: copyMap(input.data),
  stringData: copyMap(input.stringData),
  immutable: input.immutable
})

export const Secret = {
  make: <
    const N extends string,
    const Ns extends string = string,
    const K extends string = string
  >(
    input: SecretInput<N, Ns, K>
  ): SecretManifest<N, Ns, K> =>
    _withRef({
      manifest: Manifest.make(() => _buildSecret(input)),
      ref: SecretRefValue.of<N, K, Ns>(input.name)
    })
}
