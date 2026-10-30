import { brand, type ConfigMapRef as CMRef, type PvcRef as PRef, type SecretRef as SRef } from "@konfig.ts/core"

export type SecretRef<
  N extends string = string,
  K extends string = string,
  Ns extends string = string
> = SRef<N, K, Ns>

export type ConfigMapRef<N extends string = string, K extends string = string> = CMRef<N, K>

export type PvcRef<N extends string = string> = PRef<N>

declare const ServiceAccountRefBrand: unique symbol

export type ServiceAccountRef<N extends string = string> = string & {
  readonly [ServiceAccountRefBrand]: N
}

export const SecretRef = {
  of: <N extends string, K extends string = string, Ns extends string = string>(
    name: N
  ): SecretRef<N, K, Ns> => brand<SecretRef<N, K, Ns>>(name)
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
