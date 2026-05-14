// Branded refs — the brand TYPES live in `@konfig.ts/core/deps` (M9). The
// `.of()` factory functions remain here as the localized branding
// boundary that older call sites (identity.ts, the few module ports
// that haven't switched to `yield* Deps.Secret(name)` yet) need.
//
// The brand-construction cast is the standard nominal-typing idiom
// (matches Effect's `Brand.nominal`). The runtime value is a plain
// string; the brand exists only in types. **Do not propagate this
// cast elsewhere** — branding is a localized boundary, not a
// general-purpose escape hatch.

import type {
	ConfigMapRef as CMRef,
	PvcRef as PRef,
	SecretRef as SRef,
	ServiceAccountRef as SARef,
} from "@konfig.ts/core";

// Re-export the types under their original names.
export type SecretRef<N extends string = string> = SRef<N>;
export type ConfigMapRef<N extends string = string> = CMRef<N>;
export type ServiceAccountRef<N extends string = string> = SARef<N>;
export type PvcRef<N extends string = string> = PRef<N>;
export type { ConfigMapRefName, PvcRefName, SecretRefName } from "@konfig.ts/core";

// Value-side factories.
export const SecretRef = {
	of: <N extends string>(name: N): SecretRef<N> => name as unknown as SecretRef<N>,
};

export const ConfigMapRef = {
	of: <N extends string>(name: N): ConfigMapRef<N> => name as unknown as ConfigMapRef<N>,
};

export const ServiceAccountRef = {
	of: <N extends string>(name: N): ServiceAccountRef<N> =>
		name as unknown as ServiceAccountRef<N>,
};

export const PvcRef = {
	of: <N extends string>(name: N): PvcRef<N> => name as unknown as PvcRef<N>,
};
