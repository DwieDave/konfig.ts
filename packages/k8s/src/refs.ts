import {
	brand,
	type ConfigMapRef as CMRef,
	type PvcRef as PRef,
	type ServiceAccountRef as SARef,
	type SecretRef as SRef,
} from "@konfig.ts/core";

export type SecretRef<N extends string = string> = SRef<N>;
export type ConfigMapRef<N extends string = string> = CMRef<N>;
export type ServiceAccountRef<N extends string = string> = SARef<N>;
export type PvcRef<N extends string = string> = PRef<N>;
export type { ConfigMapRefName, PvcRefName, SecretRefName } from "@konfig.ts/core";

export const SecretRef = {
	of: <N extends string>(name: N): SecretRef<N> => brand<SecretRef<N>>(name),
};

export const ConfigMapRef = {
	of: <N extends string>(name: N): ConfigMapRef<N> => brand<ConfigMapRef<N>>(name),
};

export const ServiceAccountRef = {
	of: <N extends string>(name: N): ServiceAccountRef<N> => brand<ServiceAccountRef<N>>(name),
};

export const PvcRef = {
	of: <N extends string>(name: N): PvcRef<N> => brand<PvcRef<N>>(name),
};
