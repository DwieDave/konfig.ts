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

export interface SecretEnvInput {
	readonly name: string;
	readonly ref: SecretRef<string>;
	readonly key: string;
	readonly optional?: boolean;
}
export const secretEnv = (input: SecretEnvInput): EnvVar => ({
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
