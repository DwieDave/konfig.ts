import type { ConfigMapRef, SecretRef } from "@konfig.ts/core"

export interface EnvVarSource {
  readonly secretKeyRef?: {
    readonly name: SecretRef<string>
    readonly key: string
    readonly optional?: boolean
  }
  readonly configMapKeyRef?: {
    readonly name: ConfigMapRef<string>
    readonly key: string
    readonly optional?: boolean
  }
  readonly fieldRef?: { readonly fieldPath: string; readonly apiVersion?: string }
  readonly resourceFieldRef?: { readonly containerName?: string; readonly resource: string }
}

export interface EnvVarShape<N extends string = string> {
  readonly name: N
  readonly value?: string
  readonly valueFrom?: EnvVarSource
}

export interface ValueEnvInput<N extends string> {
  readonly name: N
  readonly value: string
}

export interface SecretEnvInput<EnvName extends string, N extends string, K extends string> {
  readonly name: EnvName
  readonly ref: SecretRef<N, K>
  readonly key: NoInfer<K>
  readonly optional?: boolean
}

export interface SecretEnvForPodInput<
  EnvName extends string,
  N extends string,
  K extends string,
  Ns extends string
> {
  readonly name: EnvName
  readonly ref: SecretRef<N, K, NoInfer<Ns>>
  readonly key: NoInfer<K>
  readonly podNamespace: Ns
  readonly optional?: boolean
}

export interface ConfigMapEnvInput<EnvName extends string, N extends string, K extends string> {
  readonly name: EnvName
  readonly ref: ConfigMapRef<N, K>
  readonly key: NoInfer<K>
  readonly optional?: boolean
}

export interface RawEnvInput<N extends string> {
  readonly name: N
  readonly value?: string
  readonly valueFrom?: EnvVarSource
}

export const EnvVar = {
  value: <const N extends string>(input: ValueEnvInput<N>): EnvVar<N> => ({
    name: input.name,
    value: input.value
  }),
  fromSecret: <const EnvName extends string, N extends string, K extends string = string>(
    input: SecretEnvInput<EnvName, N, K>
  ): EnvVar<EnvName> => ({
    name: input.name,
    valueFrom: {
      secretKeyRef: { name: input.ref, key: input.key, optional: input.optional }
    }
  }),
  // kube-apiserver only resolves secretKeyRef within the pod's own namespace; Ns must match podNamespace.
  fromSecretForPod: <
    const EnvName extends string,
    N extends string,
    K extends string,
    const Ns extends string
  >(
    input: SecretEnvForPodInput<EnvName, N, K, Ns>
  ): EnvVar<EnvName> => ({
    name: input.name,
    valueFrom: {
      secretKeyRef: { name: input.ref, key: input.key, optional: input.optional }
    }
  }),
  fromConfigMap: <const EnvName extends string, N extends string, K extends string = string>(
    input: ConfigMapEnvInput<EnvName, N, K>
  ): EnvVar<EnvName> => ({
    name: input.name,
    valueFrom: {
      configMapKeyRef: { name: input.ref, key: input.key, optional: input.optional }
    }
  }),
  raw: <const N extends string>(input: RawEnvInput<N>): EnvVar<N> => input
}

export type EnvVar<N extends string = string> = EnvVarShape<N>
