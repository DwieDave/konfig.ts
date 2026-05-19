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

export interface VolumeFromSecretInput {
	readonly name: string;
	readonly ref: SecretRef<string>;
	readonly optional?: boolean;
	readonly defaultMode?: number;
}
export const volumeFromSecret = (input: VolumeFromSecretInput): Volume => ({
	name: input.name,
	secret: { secretName: input.ref, optional: input.optional, defaultMode: input.defaultMode },
});

export interface VolumeFromConfigMapInput {
	readonly name: string;
	readonly ref: ConfigMapRef<string>;
	readonly optional?: boolean;
	readonly defaultMode?: number;
	readonly items?: ReadonlyArray<{ readonly key: string; readonly path: string }>;
}
export const volumeFromConfigMap = (input: VolumeFromConfigMapInput): Volume => ({
	name: input.name,
	configMap: {
		name: input.ref,
		optional: input.optional,
		defaultMode: input.defaultMode,
		items: input.items,
	},
});

export interface EmptyDirVolumeInput {
	readonly name: string;
	readonly medium?: string;
	readonly sizeLimit?: string;
}
export const emptyDirVolume = (input: EmptyDirVolumeInput): Volume => ({
	name: input.name,
	emptyDir: { medium: input.medium, sizeLimit: input.sizeLimit },
});

export interface PvcVolumeInput<N extends string> {
	readonly name: string;
	readonly claim: PvcRef<N>;
	readonly readOnly?: boolean;
}
export const pvcVolume = <N extends string>(input: PvcVolumeInput<N>): Volume => ({
	name: input.name,
	persistentVolumeClaim: { claimName: input.claim, readOnly: input.readOnly },
});
