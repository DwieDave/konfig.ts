import { coerce, type Manifest, type RenderError } from "@konfig.ts/core";
import type {
	DownwardEntry,
	EnvMember,
	Environment,
	LiteralEntry,
	SecretEntry,
	SecretSource,
} from "@konfig.ts/env";
import { Layer } from "effect";
import type { SecretBackend } from "./backend";
import type { EnvVar } from "./env";
import { bindSecret, type DeclaredSecret } from "./secretBind";

export interface DeclaredLiteral<EnvName extends string, T> {
	readonly envName: EnvName;
	readonly value: T;
	readonly envVar: EnvVar;
}

export interface DeclaredDownward<EnvName extends string> {
	readonly envName: EnvName;
	readonly fieldPath: string;
	readonly envVar: EnvVar;
}

export type DeclaredMember<A extends EnvMember> = A extends SecretEntry<
	infer N,
	infer K,
	infer _E
>
	? [N, K] extends [string, string]
		? DeclaredSecret<N, K>
		: never
	: A extends LiteralEntry<infer EnvName, infer T>
		? [EnvName] extends [string]
			? DeclaredLiteral<EnvName, T>
			: never
		: A extends DownwardEntry<infer EnvName>
			? [EnvName] extends [string]
				? DeclaredDownward<EnvName>
				: never
			: never;

export interface DeclaredEnvironment<M extends Readonly<Record<string, EnvMember>>> {
	readonly envVars: ReadonlyArray<EnvVar>;
	readonly manifests: ReadonlyArray<Manifest.Manifest<unknown>>;
	readonly members: { readonly [K in keyof M]: DeclaredMember<M[K]> };
	// merged values layer over every secret member with a source.
	readonly valuesLayer: Layer.Layer<unknown, RenderError, Manifest.RenderServices>;
}

export interface SecretMemberOptions<N extends string, K extends string> {
	readonly backend?: SecretBackend<N, K>;
	readonly source?: SecretSource<K, Manifest.RenderServices>;
	readonly labels?: Readonly<Record<string, string>>;
	readonly annotations?: Readonly<Record<string, string>>;
}

export type SecretMemberOptionsFor<A> = A extends SecretEntry<infer N, infer K, infer _E>
	? [N, K] extends [string, string]
		? SecretMemberOptions<N, K>
		: never
	: never;

export type SecretMembersOpts<M extends Readonly<Record<string, EnvMember>>> = {
	readonly [K in keyof M as M[K] extends SecretEntry<infer _N, infer _K, infer _E>
		? K
		: never]?: SecretMemberOptionsFor<M[K]>;
};

/**
 * Per-literal value override for bind time. Keyed by member name, typed
 * to each literal's declared `T`. Useful when a `defineLiteral` is a
 * runtime contract (carries a `schema: Config.string(envName)` for app
 * code to yield) but the manifest's emitted value differs per env —
 * e.g. `CLIENT_URL`, `S3_ENDPOINT`, host/URL literals.
 */
export type LiteralMembersOpts<M extends Readonly<Record<string, EnvMember>>> = {
	readonly [K in keyof M as M[K] extends LiteralEntry<infer _EnvName, infer _T>
		? K
		: never]?: M[K] extends LiteralEntry<infer _EnvName, infer T> ? T : never;
};

export interface BindEnvironmentInput<M extends Readonly<Record<string, EnvMember>>> {
	readonly env: Environment<M>;
	readonly secrets?: SecretMembersOpts<M>;
	/**
	 * Per-literal value override for the manifest's emitted env var. The
	 * runtime read (via `entry.schema`, if provided) is unchanged —
	 * overrides only affect what the konfig module writes into the
	 * Deployment's `env` array.
	 */
	readonly literals?: LiteralMembersOpts<M>;
	/**
	 * Override every secret member's namespace for this bind. Useful when
	 * the bundle is consumed across multiple k8s namespaces (e.g. prod /
	 * staging / local) without redeclaring each contract.
	 */
	readonly namespace?: string;
}

interface _BindLiteralInput {
	readonly entry: LiteralEntry<string, unknown>;
	readonly override?: unknown;
}
const _bindLiteral = (input: _BindLiteralInput): DeclaredLiteral<string, unknown> => {
	const hasOverride = input.override !== undefined;
	const value = hasOverride ? input.override : input.entry.value;
	const serialized = hasOverride
		? input.entry.serialize(input.override)
		: input.entry.serialized;
	return {
		envName: input.entry.envName,
		value,
		envVar: { name: input.entry.envName, value: serialized },
	};
};

interface _BindDownwardInput {
	readonly entry: DownwardEntry<string>;
}
const _bindDownward = (input: _BindDownwardInput): DeclaredDownward<string> => ({
	envName: input.entry.envName,
	fieldPath: input.entry.fieldPath,
	envVar: {
		name: input.entry.envName,
		valueFrom: { fieldRef: { fieldPath: input.entry.fieldPath } },
	},
});

export const bindEnvironment = <const M extends Readonly<Record<string, EnvMember>>>(
	input: BindEnvironmentInput<M>,
): DeclaredEnvironment<M> => {
	const { env, secrets } = input;
	const declared: Record<string, unknown> = {};
	const envVars: EnvVar[] = [];
	const manifests: Manifest.Manifest<unknown>[] = [];
	const valuesLayers: Layer.Layer<unknown, RenderError, Manifest.RenderServices>[] = [];
	const opts = coerce<Record<string, SecretMemberOptions<string, string> | undefined>>(secrets);

	for (const memberKey of Object.keys(env.members)) {
		const entry = coerce<EnvMember>(env.members[memberKey]);
		if (entry._kind === "Secret") {
			const memberOpts = opts?.[memberKey];
			const d = bindSecret({
				secret: entry,
				backend: memberOpts?.backend,
				source: memberOpts?.source,
				labels: memberOpts?.labels,
				annotations: memberOpts?.annotations,
				namespace: input.namespace,
			});
			declared[memberKey] = d;
			envVars.push(...d.envVars);
			if (d.manifest !== undefined) manifests.push(d.manifest);
			if (d.layer !== undefined)
				valuesLayers.push(
					coerce<Layer.Layer<unknown, RenderError, Manifest.RenderServices>>(d.layer),
				);
		} else if (entry._kind === "Literal") {
			const literalOverride = coerce<Record<string, unknown> | undefined>(input.literals)?.[memberKey];
			const d = _bindLiteral({ entry, override: literalOverride });
			declared[memberKey] = d;
			envVars.push(d.envVar);
		} else {
			const d = _bindDownward({ entry });
			declared[memberKey] = d;
			envVars.push(d.envVar);
		}
	}

	const valuesLayer = coerce<Layer.Layer<unknown, RenderError, Manifest.RenderServices>>(
		valuesLayers.length === 0
			? Layer.empty
			: Layer.mergeAll(valuesLayers[0]!, ...valuesLayers.slice(1)),
	);

	return {
		envVars,
		manifests,
		members: coerce<{ readonly [K in keyof M]: DeclaredMember<M[K]> }>(declared),
		valuesLayer,
	};
};
