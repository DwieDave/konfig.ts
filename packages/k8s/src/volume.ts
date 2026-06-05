import { brand } from "@konfig.ts/core";
import type { ConfigMapRef, PvcRef, SecretRef } from "@konfig.ts/core";

/**
 * Branded volume name — a string carrying the literal `N` in its
 * phantom. Constructed by the volume factories
 * (`Volume.empty`, `Volume.fromSecret`, …) and `Volume.mountRef`. Lets
 * `VolumeMount<Mounts>` and `definePod` constrain a container's
 * `volumeMounts[i].name` to volumes that the pod actually declares.
 */
declare const VolumeNameBrand: unique symbol;
export type VolumeName<N extends string> = string & {
	readonly [VolumeNameBrand]: N;
};

const _volumeName = <const N extends string>(name: N): VolumeName<N> =>
	brand<VolumeName<N>>(name);

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

export interface EmptyVolumeInput<N extends string> {
	readonly name: N;
	readonly medium?: string;
	readonly sizeLimit?: string;
}

export interface VolumeFromSecretInput<N extends string> {
	readonly name: N;
	readonly ref: SecretRef<string>;
	readonly optional?: boolean;
	readonly defaultMode?: number;
}

export interface VolumeFromConfigMapInput<N extends string> {
	readonly name: N;
	readonly ref: ConfigMapRef<string>;
	readonly optional?: boolean;
	readonly defaultMode?: number;
	readonly items?: ReadonlyArray<{ readonly key: string; readonly path: string }>;
}

export interface VolumeFromPvcInput<N extends string, PvcN extends string> {
	readonly name: N;
	readonly claim: PvcRef<PvcN>;
	readonly readOnly?: boolean;
}

/**
 * `Volume` value namespace.
 *
 *   volumes: [
 *     Volume.empty({ name: "config" }),
 *     Volume.fromSecret({ name: "tls", ref: tlsSecret.ref }),
 *     Volume.fromConfigMap({ name: "settings", ref: cfg.ref }),
 *     Volume.fromPvc({ name: "data", claim: pvc.ref }),
 *   ],
 *   volumeMounts: [
 *     { name: Volume.mountRef("config"), mountPath: "/etc/conf" },
 *   ],
 *
 * All four constructors capture the literal `name` in the returned
 * `Volume<N>` brand; `definePod` infers the union and constrains each
 * container's `volumeMounts[i].name` to it.
 */
export const Volume = {
	empty: <const N extends string>(input: EmptyVolumeInput<N>): Volume<N> => ({
		name: _volumeName(input.name),
		emptyDir: { medium: input.medium, sizeLimit: input.sizeLimit },
	}),
	fromSecret: <const N extends string>(input: VolumeFromSecretInput<N>): Volume<N> => ({
		name: _volumeName(input.name),
		secret: {
			secretName: input.ref,
			optional: input.optional,
			defaultMode: input.defaultMode,
		},
	}),
	fromConfigMap: <const N extends string>(input: VolumeFromConfigMapInput<N>): Volume<N> => ({
		name: _volumeName(input.name),
		configMap: {
			name: input.ref,
			optional: input.optional,
			defaultMode: input.defaultMode,
			items: input.items,
		},
	}),
	fromPvc: <const N extends string, const PvcN extends string>(
		input: VolumeFromPvcInput<N, PvcN>,
	): Volume<N> => ({
		name: _volumeName(input.name),
		persistentVolumeClaim: { claimName: input.claim, readOnly: input.readOnly },
	}),
	mountRef: <const N extends string>(name: N): VolumeName<N> => _volumeName(name),
};

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
