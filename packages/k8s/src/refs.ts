import {
  brand,
  type ConfigMapRef as CMRef,
  type PvcRef as PRef,
  type SecretRef as SRef,
  type ServiceAccountRef as SARef
} from "@konfig.ts/core"

export type SecretRef<
  N extends string = string,
  K extends string = string,
  Ns extends string = string
> = SRef<N, K, Ns>

export type ConfigMapRef<N extends string = string, K extends string = string> = CMRef<N, K>

export type PvcRef<N extends string = string> = PRef<N>

export type ServiceAccountRef<N extends string = string> = SARef<N>

export type { ConfigMapRefName, PvcRefName, SecretRefName } from "@konfig.ts/core"

// konfig: WHY `any` in the namespace slot is assignable to every pod namespace; only a type alias may spell it.
type AnyNamespaceSecretRef<N extends string, K extends string> = SecretRef<N, K, any>

export const SecretRef = {
  of: <N extends string, K extends string = string, Ns extends string = string>(
    name: N
  ): SecretRef<N, K, Ns> => brand<SecretRef<N, K, Ns>>(name),
  // Escape hatch for a legitimate cross-namespace ref: widens the namespace slot so any pod namespace accepts it.
  unsafeReNamespace: <N extends string, K extends string>(
    ref: AnyNamespaceSecretRef<N, K>
  ): AnyNamespaceSecretRef<N, K> => ref
}

export const ConfigMapRef = {
  of: <N extends string, K extends string = string>(name: N): ConfigMapRef<N, K> => brand<ConfigMapRef<N, K>>(name)
}

export const ServiceAccountRef = {
  of: <N extends string>(name: N): ServiceAccountRef<N> => brand<ServiceAccountRef<N>>(name)
}

export const PvcRef = {
  of: <N extends string>(name: N): PvcRef<N> => brand<PvcRef<N>>(name)
}
