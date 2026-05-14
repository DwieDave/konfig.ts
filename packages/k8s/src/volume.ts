// Volume — plain record matching k8s `Volume` shape. The phantom R
// brand moved off this type in M9; callers `yield* Secret(name)` /
// `yield* ConfigMap(name)` / `yield* Pvc(name)` upstream to lift the
// requirement before constructing the Volume entry.

import type { ConfigMapRef, PvcRef, SecretRef } from "@konfig.ts/core";

export interface Volume {
	readonly name: string;
	readonly secret?: {
		readonly secretName: string;
		readonly optional?: boolean;
		readonly defaultMode?: number;
	};
	readonly configMap?: {
		readonly name: string;
		readonly optional?: boolean;
		readonly defaultMode?: number;
		readonly items?: ReadonlyArray<{ readonly key: string; readonly path: string }>;
	};
	readonly emptyDir?: { readonly medium?: string; readonly sizeLimit?: string };
	readonly persistentVolumeClaim?: {
		readonly claimName: PvcRef<string>;
		readonly readOnly?: boolean;
	};
	readonly hostPath?: { readonly path: string; readonly type?: string };
}

export const volumeFromSecret = (
	name: string,
	ref: SecretRef<string>,
	opts?: { readonly optional?: boolean; readonly defaultMode?: number },
): Volume => ({
	name,
	secret: { secretName: ref, optional: opts?.optional, defaultMode: opts?.defaultMode },
});

export const volumeFromConfigMap = (
	name: string,
	ref: ConfigMapRef<string>,
	opts?: {
		readonly optional?: boolean;
		readonly defaultMode?: number;
		readonly items?: ReadonlyArray<{ readonly key: string; readonly path: string }>;
	},
): Volume => ({
	name,
	configMap: {
		name: ref,
		optional: opts?.optional,
		defaultMode: opts?.defaultMode,
		items: opts?.items,
	},
});

export const emptyDirVolume = (
	name: string,
	opts?: { readonly medium?: string; readonly sizeLimit?: string },
): Volume => ({
	name,
	emptyDir: opts ?? {},
});

export const pvcVolume = <N extends string>(
	name: string,
	claim: PvcRef<N>,
	opts?: { readonly readOnly?: boolean },
): Volume => ({
	name,
	persistentVolumeClaim: { claimName: claim, readOnly: opts?.readOnly },
});
