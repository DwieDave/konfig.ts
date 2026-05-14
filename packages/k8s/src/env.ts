// EnvVar — a plain record matching the k8s `EnvVar` shape. The R
// tracking that used to live on this type as a phantom brand moved to
// the surrounding Effect.gen: callers now `yield* Secret(name)` /
// `yield* ConfigMap(name)` to lift the requirement before constructing
// the env entry. See `.docs/workflows/tsk-typesafe-k8s/m9-effect-port.md`.

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

// Literal-string env var.
export const valueEnv = (name: string, value: string): EnvVar => ({ name, value });

// Secret-sourced env var. The `ref` must be a branded `SecretRef` —
// callers obtain one by `yield* Secret(name)` upstream. Raw strings
// are rejected at the signature.
export const secretEnv = (
	name: string,
	from: { readonly ref: SecretRef<string>; readonly key: string; readonly optional?: boolean },
): EnvVar => ({
	name,
	valueFrom: {
		secretKeyRef: { name: from.ref, key: from.key, optional: from.optional },
	},
});

// ConfigMap-sourced env var. Same branding rule as `secretEnv`.
export const configMapEnv = (
	name: string,
	from: {
		readonly ref: ConfigMapRef<string>;
		readonly key: string;
		readonly optional?: boolean;
	},
): EnvVar => ({
	name,
	valueFrom: {
		configMapKeyRef: { name: from.ref, key: from.key, optional: from.optional },
	},
});

// Escape hatch for env entries that don't reference a branded resource
// (fieldRef, resourceFieldRef). No yield required.
export const rawEnv = (entry: {
	readonly name: string;
	readonly value?: string;
	readonly valueFrom?: EnvVarSource;
}): EnvVar => entry;
