import { brand } from "@konfig.ts/core";
import type { ConfigMapRef, PvcRef, SecretRef } from "@konfig.ts/core";

/**
 * Branded volume name — a string carrying the literal `N` in its
 * phantom. Constructed by the volume factories
 * (`emptyDirVolume`, `volumeFromSecret`, …) and `mountRef`. Lets
 * `VolumeMount<Mounts>` and `definePod` constrain a container's
 * `volumeMounts[i].name` to volumes that the pod actually declares.
 */
declare const VolumeNameBrand: unique symbol;
export type VolumeName<N extends string> = string & {
	readonly [VolumeNameBrand]: N;
};

const _volumeName = <const N extends string>(name: N): VolumeName<N> =>
	brand<VolumeName<N>>(name);

/**
 * Reference an existing pod-declared volume from a container's
 * `volumeMounts[].name`. Use inside `defineContainer({ volumeMounts: [...] })`
 * when the resulting container is fed to `definePod` — the pod builder
 * binds the union of declared volume names to the container's Mounts
 * phantom.
 */
export const mountRef = <const N extends string>(name: N): VolumeName<N> =>
	_volumeName(name);

export interface Volume<N extends string = string> {
	readonly name: VolumeName<N>;
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

export interface VolumeFromSecretInput<N extends string> {
	readonly name: N;
	readonly ref: SecretRef<string>;
	readonly optional?: boolean;
	readonly defaultMode?: number;
}
export const volumeFromSecret = <const N extends string>(
	input: VolumeFromSecretInput<N>,
): Volume<N> => ({
	name: _volumeName(input.name),
	secret: { secretName: input.ref, optional: input.optional, defaultMode: input.defaultMode },
});

export interface VolumeFromConfigMapInput<N extends string> {
	readonly name: N;
	readonly ref: ConfigMapRef<string>;
	readonly optional?: boolean;
	readonly defaultMode?: number;
	readonly items?: ReadonlyArray<{ readonly key: string; readonly path: string }>;
}
export const volumeFromConfigMap = <const N extends string>(
	input: VolumeFromConfigMapInput<N>,
): Volume<N> => ({
	name: _volumeName(input.name),
	configMap: {
		name: input.ref,
		optional: input.optional,
		defaultMode: input.defaultMode,
		items: input.items,
	},
});

export interface EmptyDirVolumeInput<N extends string> {
	readonly name: N;
	readonly medium?: string;
	readonly sizeLimit?: string;
}
export const emptyDirVolume = <const N extends string>(
	input: EmptyDirVolumeInput<N>,
): Volume<N> => ({
	name: _volumeName(input.name),
	emptyDir: { medium: input.medium, sizeLimit: input.sizeLimit },
});

export interface PvcVolumeInput<N extends string, PvcN extends string> {
	readonly name: N;
	readonly claim: PvcRef<PvcN>;
	readonly readOnly?: boolean;
}
export const pvcVolume = <const N extends string, const PvcN extends string>(
	input: PvcVolumeInput<N, PvcN>,
): Volume<N> => ({
	name: _volumeName(input.name),
	persistentVolumeClaim: { claimName: input.claim, readOnly: input.readOnly },
});

/**
 * Typed container volumeMount. `Mounts` is the union of volume names
 * declared on the surrounding pod; `name` must reference one of them.
 * Bare-number variants don't apply (mounts are always by name).
 */
export interface VolumeMount<Mounts extends string = string> {
	readonly name: VolumeName<Mounts>;
	readonly mountPath: string;
	readonly readOnly?: boolean;
	readonly subPath?: string;
	readonly subPathExpr?: string;
	readonly mountPropagation?: string;
}

export type VolumeNamesOf<V extends ReadonlyArray<Volume<string>>> = {
	readonly [I in keyof V]: V[I] extends Volume<infer N> ? N : never;
}[number];
