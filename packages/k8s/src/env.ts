import type { ConfigMapRef, SecretRef } from "@konfig.ts/core";

/**
 * Container env-var entry. The phantom `N` records the literal env-var
 * name at the type level so `defineContainer` can detect duplicates
 * across the entry list. The default `N = string` preserves existing
 * loose-typed call sites.
 */
export interface EnvVar<N extends string = string> {
	readonly name: N;
	readonly value?: string;
	readonly valueFrom?: EnvVarSource;
}

export interface EnvVarSource {
	readonly secretKeyRef?: {
		readonly name: string;
		readonly key: string;
		readonly optional?: boolean;
	};
	readonly configMapKeyRef?: {
		readonly name: string;
		readonly key: string;
		readonly optional?: boolean;
	};
	readonly fieldRef?: { readonly fieldPath: string; readonly apiVersion?: string };
	readonly resourceFieldRef?: { readonly containerName?: string; readonly resource: string };
}

export interface ValueEnvInput<N extends string> {
	readonly name: N;
	readonly value: string;
}
export const valueEnv = <const N extends string>(input: ValueEnvInput<N>): EnvVar<N> => ({
	name: input.name,
	value: input.value,
});

export interface SecretEnvInput<EnvName extends string, N extends string, K extends string> {
	readonly name: EnvName;
	readonly ref: SecretRef<N, K>;
	/**
	 * Constrained to the keys carried by `ref`. `NoInfer` locks `K` to
	 * whatever the ref declares, so the typo `key: "passowrd"` fails at
	 * compile time when the ref's K is `"url" | "username" | "password"`.
	 * Refs constructed with the default `K = string` accept any string.
	 */
	readonly key: NoInfer<K>;
	readonly optional?: boolean;
}
export const secretEnv = <
	const EnvName extends string,
	N extends string,
	K extends string = string,
>(
	input: SecretEnvInput<EnvName, N, K>,
): EnvVar<EnvName> => ({
	name: input.name,
	valueFrom: {
		secretKeyRef: { name: input.ref, key: input.key, optional: input.optional },
	},
});

export interface ConfigMapEnvInput<EnvName extends string, N extends string, K extends string> {
	readonly name: EnvName;
	readonly ref: ConfigMapRef<N, K>;
	/**
	 * Constrained to the keys carried by `ref`. `NoInfer` locks `K` to
	 * whatever the ref declares — typos like `key: "passwrod"` fail at
	 * compile time when the ref's K is `"HOST" | "PORT" | "LOG_LEVEL"`.
	 * Refs constructed with the default `K = string` accept any string.
	 */
	readonly key: NoInfer<K>;
	readonly optional?: boolean;
}
export const configMapEnv = <
	const EnvName extends string,
	N extends string,
	K extends string = string,
>(
	input: ConfigMapEnvInput<EnvName, N, K>,
): EnvVar<EnvName> => ({
	name: input.name,
	valueFrom: {
		configMapKeyRef: { name: input.ref, key: input.key, optional: input.optional },
	},
});

export const rawEnv = <const N extends string>(entry: {
	readonly name: N;
	readonly value?: string;
	readonly valueFrom?: EnvVarSource;
}): EnvVar<N> => entry;
