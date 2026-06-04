import type { ConfigMapRef, SecretRef } from "@konfig.ts/core";

export interface EnvVar {
	readonly name: string;
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

export interface ValueEnvInput {
	readonly name: string;
	readonly value: string;
}
export const valueEnv = (input: ValueEnvInput): EnvVar => ({
	name: input.name,
	value: input.value,
});

export interface SecretEnvInput<N extends string, K extends string> {
	readonly name: string;
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
export const secretEnv = <N extends string, K extends string = string>(
	input: SecretEnvInput<N, K>,
): EnvVar => ({
	name: input.name,
	valueFrom: {
		secretKeyRef: { name: input.ref, key: input.key, optional: input.optional },
	},
});

export interface ConfigMapEnvInput {
	readonly name: string;
	readonly ref: ConfigMapRef<string>;
	readonly key: string;
	readonly optional?: boolean;
}
export const configMapEnv = (input: ConfigMapEnvInput): EnvVar => ({
	name: input.name,
	valueFrom: {
		configMapKeyRef: { name: input.ref, key: input.key, optional: input.optional },
	},
});

export const rawEnv = (entry: {
	readonly name: string;
	readonly value?: string;
	readonly valueFrom?: EnvVarSource;
}): EnvVar => entry;
