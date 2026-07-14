import type { ConfigMapRef, SecretRef, ServiceAccountRef } from "@konfig.ts/core"
import { Manifest } from "@konfig.ts/core"
import { Effect } from "effect"
import type {
  ConfigMap as K8sConfigMap,
  Namespace as K8sNamespace,
  Secret as K8sSecret,
  ServiceAccount as K8sServiceAccount
} from "./.generated/k8s-types"
import {
  ConfigMapRef as ConfigMapRefValue,
  SecretRef as SecretRefValue,
  ServiceAccountRef as ServiceAccountRefValue
} from "./refs"

type CommonMeta = {
  readonly labels?: Readonly<Record<string, string>>
  readonly annotations?: Readonly<Record<string, string>>
}

export interface NamespaceInput<N extends string> extends CommonMeta {
  readonly name: N
}

export interface NamespaceManifest<N extends string> extends Manifest.Manifest<K8sNamespace> {
  readonly ref: N
}

export const Namespace = {
  make: <N extends string>(input: NamespaceInput<N>): NamespaceManifest<N> => {
    const resource: K8sNamespace = {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: {
        name: input.name,
        labels: input.labels,
        annotations: input.annotations
      }
    }
    const m = Manifest.make<K8sNamespace>(() => Effect.succeed(resource))
    return Object.assign(m, { ref: input.name })
  }
}

export interface ServiceAccountInput<N extends string> extends CommonMeta {
  readonly name: N
  readonly namespace: string
  readonly automountServiceAccountToken?: boolean
  readonly imagePullSecrets?: ReadonlyArray<{ readonly name: SecretRef<string> }>
}

export interface ServiceAccountManifest<N extends string> extends Manifest.Manifest<K8sServiceAccount> {
  readonly ref: ServiceAccountRef<N>
}

export const ServiceAccount = {
  make: <N extends string>(input: ServiceAccountInput<N>): ServiceAccountManifest<N> => {
    const resource: K8sServiceAccount = {
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: {
        name: input.name,
        namespace: input.namespace,
        labels: input.labels,
        annotations: input.annotations
      },
      automountServiceAccountToken: input.automountServiceAccountToken,
      imagePullSecrets: input.imagePullSecrets?.map((s) => ({ name: s.name }))
    }
    const m = Manifest.make<K8sServiceAccount>(() => Effect.succeed(resource))
    return Object.assign(m, { ref: ServiceAccountRefValue.of(input.name) })
  }
}

export interface ConfigMapInput<N extends string, K extends string = string> extends CommonMeta {
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

export const ConfigMap = {
  make: <const N extends string, const K extends string = string>(
    input: ConfigMapInput<N, K>
  ): ConfigMapManifest<N, K> => {
    const resource: K8sConfigMap = {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: {
        name: input.name,
        namespace: input.namespace,
        labels: input.labels,
        annotations: input.annotations
      },
      data: input.data,
      binaryData: input.binaryData,
      immutable: input.immutable
    }
    const m = Manifest.make<K8sConfigMap>(() => Effect.succeed(resource))
    return Object.assign(m, { ref: ConfigMapRefValue.of<N, K>(input.name) })
  }
}

export interface SecretInput<
  N extends string,
  Ns extends string = string,
  K extends string = string
> extends CommonMeta {
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

export const Secret = {
  make: <
    const N extends string,
    const Ns extends string = string,
    const K extends string = string
  >(
    input: SecretInput<N, Ns, K>
  ): SecretManifest<N, Ns, K> => {
    const resource: K8sSecret = {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: input.name,
        namespace: input.namespace,
        labels: input.labels,
        annotations: input.annotations
      },
      type: input.type,
      data: input.data,
      stringData: input.stringData,
      immutable: input.immutable
    }
    const m = Manifest.make<K8sSecret>(() => Effect.succeed(resource))
    return Object.assign(m, { ref: SecretRefValue.of<N, K, Ns>(input.name) })
  }
}
