import {
	brand,
	type ConfigMapRef as CMRef,
	type PvcRef as PRef,
	type ServiceAccountRef as SARef,
	type SecretRef as SRef,
} from "@konfig.ts/core";

export type SecretRef<
	N extends string = string,
	K extends string = string,
	Ns extends string = string,
> = SRef<N, K, Ns>;
export type ConfigMapRef<N extends string = string, K extends string = string> = CMRef<N, K>;
export type ServiceAccountRef<N extends string = string> = SARef<N>;
export type PvcRef<N extends string = string> = PRef<N>;
export type {
	ConfigMapRefKeys,
	ConfigMapRefName,
	PvcRefName,
	SecretRefKeys,
	SecretRefName,
} from "@konfig.ts/core";
export type { SecretRefNamespace } from "@konfig.ts/core";

export const SecretRef = {
	of: <N extends string, K extends string = string, Ns extends string = string>(
		name: N,
	): SecretRef<N, K, Ns> => brand<SecretRef<N, K, Ns>>(name),
	/**
	 * Escape hatch — widen a typed ref's namespace slot to `any`, making
	 * it usable across any pod context. Use sparingly (legitimate
	 * cross-namespace cases: ExternalSecret reflection, in-cluster
	 * shared infra). The cast is grep-able so PR reviewers see opt-ins.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	unsafeReNamespace: <N extends string, K extends string>(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		ref: SecretRef<N, K, any>,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	): SecretRef<N, K, any> => ref,
};

export const ConfigMapRef = {
	of: <N extends string, K extends string = string>(name: N): ConfigMapRef<N, K> =>
		brand<ConfigMapRef<N, K>>(name),
};

export const ServiceAccountRef = {
	of: <N extends string>(name: N): ServiceAccountRef<N> => brand<ServiceAccountRef<N>>(name),
};

export const PvcRef = {
	of: <N extends string>(name: N): PvcRef<N> => brand<PvcRef<N>>(name),
};
