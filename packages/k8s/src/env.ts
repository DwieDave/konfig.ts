import {
  type ConfigMapRef,
  type ConfigMapRefKeys,
  type SecretRef,
  type SecretRefKeys,
  type SecretRefNamespace,
  unsafeCoerce
} from "@konfig.ts/core"

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

export interface SecretEnvOptions<R> {
  // kube-apiserver only resolves secretKeyRef within the pod's own namespace; when given, must match the ref's brand.
  readonly podNamespace?: SecretRefNamespace<R>
  readonly optional?: boolean
}

export interface ConfigMapEnvOptions {
  readonly optional?: boolean
}

// Env-var name → key in the referenced Secret/ConfigMap. Names are the object keys so they stay literal for
// Container.define's duplicate-name check.
export type EnvKeyMap<K extends string> = Readonly<Record<string, K>>

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
  // Batch form: many env vars from one secret ref; podNamespace folds in the fromSecretForPod check.
  // oxlint-disable-next-line app/no-multiple-function-params -- (ref, map, opts?) reads as a call, not a config
  secretEnv: <
    R extends SecretRef<string, string, string>,
    const Map extends EnvKeyMap<SecretRefKeys<R>>
  >(
    ref: R,
    map: Map,
    opts?: SecretEnvOptions<R>
  ): ReadonlyArray<EnvVar<keyof Map & string>> =>
    Object.entries(map).map(([name, key]) => ({
      name: unsafeCoerce<keyof Map & string>(name, "Object.entries of Map yields its own keys"),
      valueFrom: { secretKeyRef: { name: ref, key, optional: opts?.optional } }
    })),
  // oxlint-disable-next-line app/no-multiple-function-params -- same shape as secretEnv
  configMapEnv: <
    R extends ConfigMapRef<string, string>,
    const Map extends EnvKeyMap<ConfigMapRefKeys<R>>
  >(
    ref: R,
    map: Map,
    opts?: ConfigMapEnvOptions
  ): ReadonlyArray<EnvVar<keyof Map & string>> =>
    Object.entries(map).map(([name, key]) => ({
      name: unsafeCoerce<keyof Map & string>(name, "Object.entries of Map yields its own keys"),
      valueFrom: { configMapKeyRef: { name: ref, key, optional: opts?.optional } }
    })),
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
