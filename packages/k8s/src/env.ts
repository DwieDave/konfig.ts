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

/**
 * Container env-var entry. The phantom `N` records the literal env-var
 * name at the type level so `Container` can detect duplicates
 * across the entry list. The default `N = string` preserves loose-typed
 * call sites.
 */
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
  /**
   * Constrained to the keys carried by `ref`. `NoInfer` locks `K` to
   * whatever the ref declares, so the typo `key: "passowrd"` fails at
   * compile time when the ref's K is `"url" | "username" | "password"`.
   * Refs constructed with the default `K = string` accept any string.
   */
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
  /**
   * Ref whose namespace slot must match `podNamespace`. Pass refs that
   * came from `Secret.make({ namespace })` in the same namespace as
   * the consuming pod. For legitimate cross-namespace cases, widen
   * via `SecretRef.unsafeReNamespace(ref)` first.
   */
  readonly ref: SecretRef<N, K, NoInfer<Ns>>
  readonly key: NoInfer<K>
  readonly podNamespace: Ns
  readonly optional?: boolean
}

export interface ConfigMapEnvInput<EnvName extends string, N extends string, K extends string> {
  readonly name: EnvName
  readonly ref: ConfigMapRef<N, K>
  /**
   * Constrained to the keys carried by `ref`. `NoInfer` locks `K` to
   * whatever the ref declares — typos like `key: "passwrod"` fail at
   * compile time when the ref's K is `"HOST" | "PORT" | "LOG_LEVEL"`.
   * Refs constructed with the default `K = string` accept any string.
   */
  readonly key: NoInfer<K>
  readonly optional?: boolean
}

export interface RawEnvInput<N extends string> {
  readonly name: N
  readonly value?: string
  readonly valueFrom?: EnvVarSource
}

/**
 * `EnvVar` value namespace.
 *
 *   env: [
 *     EnvVar.value({ name: "PORT", value: "8080" }),
 *     EnvVar.fromSecret({ name: "DB_URL", ref: dbCreds.ref, key: "url" }),
 *     EnvVar.fromSecretForPod({
 *       name: "DB_URL_PRIMARY", ref: dbCreds.ref, key: "url",
 *       podNamespace: "app",
 *     }),
 *     EnvVar.fromConfigMap({ name: "NEW_UI", ref: flags.ref, key: "NEW_UI" }),
 *     EnvVar.raw({ name: "POD_NAME", valueFrom: { fieldRef: ... } }),
 *   ]
 *
 * Each constructor captures the literal env-var name (`N`) so
 * `Container` can detect duplicate entries across the env list.
 */
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
  /**
   * Namespace-checked variant. The ref's namespace slot (`Ns`) must
   * match `podNamespace`. Catches "pod in namespace A references a
   * Secret in namespace B" at compile time — kube-apiserver only
   * resolves `valueFrom.secretKeyRef` against the pod's own namespace,
   * so cross-namespace refs are runtime errors.
   */
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

// Alias the shape interface as the user-facing `EnvVar<N>` type. The
// namespace `EnvVar` (value) and the type `EnvVar<N>` share a name —
// TypeScript merges them.
export type EnvVar<N extends string = string> = EnvVarShape<N>
