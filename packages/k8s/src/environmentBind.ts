import { coerce, type Manifest, type RenderError } from "@konfig.ts/core";
import type {
	AnyEnvironment,
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

/**
 * Per-member declared shape produced by `Environment.bind`. Mirrors the
 * structure of the bundle: secrets give `DeclaredSecret`, literals
 * `DeclaredLiteral`, downwards `DeclaredDownward`, and nested
 * `Environment` members give a `members` sub-record with the same
 * recursive shape.
 */
export type DeclaredMember<A extends EnvMember> = A extends SecretEntry<infer N, infer K, infer _E>
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
			: A extends Environment<infer SubM>
				? { readonly [K in keyof SubM]: DeclaredMember<SubM[K]> }
				: never;

export interface DeclaredEnvironment<M extends Readonly<Record<string, EnvMember>>> {
	readonly envVars: ReadonlyArray<EnvVar>;
	readonly manifests: ReadonlyArray<Manifest.Manifest<unknown>>;
	readonly members: { readonly [K in keyof M]: DeclaredMember<M[K]> };
	// merged values layer over every secret member with a source.
	readonly valuesLayer: Layer.Layer<unknown, RenderError, Manifest.RenderServices>;
}

interface _SecretMemberOptionsBase {
	readonly labels?: Readonly<Record<string, string>>;
	readonly annotations?: Readonly<Record<string, string>>;
}

interface _SecretMemberWithBackend<N extends string, K extends string>
	extends _SecretMemberOptionsBase {
	readonly backend: SecretBackend<N, K>;
	readonly source?: SecretSource<K, Manifest.RenderServices>;
}

interface _SecretMemberWithSource<N extends string, K extends string>
	extends _SecretMemberOptionsBase {
	readonly backend?: SecretBackend<N, K>;
	readonly source: SecretSource<K, Manifest.RenderServices>;
}

/**
 * Per-secret-member options at bind time. At least one of `backend`
 * (emit the in-cluster Secret manifest) or `source` (provide values to
 * the in-process `SecretValues` layer for tests / local renders) must
 * be supplied — a `defineSecret` declaration without either is a hole
 * that produces `secretKeyRef` envVars pointing at a Secret nothing
 * else creates.
 */
export type SecretMemberOptions<N extends string, K extends string> =
	| _SecretMemberWithBackend<N, K>
	| _SecretMemberWithSource<N, K>;

export type SecretMemberOptionsFor<A> = A extends SecretEntry<infer N, infer K, infer _E>
	? [N, K] extends [string, string]
		? SecretMemberOptions<N, K>
		: never
	: never;

/**
 * True iff `M` (recursively, via nested `Environment` members)
 * contains at least one `SecretEntry`. Used to flip `secrets` between
 * required (any secrets present) and optional (literals/downwards
 * only) on `BindEnvironmentInput`.
 */
export type HasSecrets<M extends Readonly<Record<string, EnvMember>>> = true extends {
	readonly [K in keyof M]: M[K] extends SecretEntry<infer _N, infer _K, infer _E>
		? true
		: M[K] extends Environment<infer Sub>
			? HasSecrets<Sub>
			: false;
}[keyof M]
	? true
	: false;

/**
 * Recursive per-member secret options. For a secret member, the option
 * matches its `SecretMemberOptionsFor` and is required. For a nested
 * `Environment` member that itself contains secrets, the option is
 * `SecretMembersOpts<SubM>` and is also required. Nested environments
 * with no secrets are omitted entirely (no key needed).
 *
 * Together with `HasSecrets`, this enforces at compile time that every
 * `defineSecret` reachable from the bundle is acknowledged at bind
 * time — adding a new secret to the env contract forces every call
 * site to update.
 */
export type SecretMembersOpts<M extends Readonly<Record<string, EnvMember>>> = {
	readonly [K in keyof M as M[K] extends SecretEntry<infer _N, infer _K, infer _E>
		? K
		: M[K] extends Environment<infer SubM>
			? HasSecrets<SubM> extends true
				? K
				: never
			: never]: M[K] extends SecretEntry<infer _N, infer _K, infer _E>
		? SecretMemberOptionsFor<M[K]>
		: M[K] extends Environment<infer SubM>
			? SecretMembersOpts<SubM>
			: never;
};

/**
 * Per-literal value override for bind time. Keyed by member name, typed
 * to each literal's declared `T`. Useful when a `defineLiteral` is a
 * runtime contract (carries a `schema: Config.string(envName)` for app
 * code to yield) but the manifest's emitted value differs per env —
 * e.g. `CLIENT_URL`, `S3_ENDPOINT`, host/URL literals.
 *
 * Recurses on nested `Environment` members — pass `{group: {host: "x"}}`
 * to override a literal nested inside a sub-bundle.
 */
export type LiteralMembersOpts<M extends Readonly<Record<string, EnvMember>>> = {
	readonly [K in keyof M as M[K] extends LiteralEntry<infer _EnvName, infer _T>
		? K
		: M[K] extends Environment<infer _SubM>
			? K
			: never]?: M[K] extends LiteralEntry<infer _EnvName, infer T>
		? T
		: M[K] extends Environment<infer SubM>
			? LiteralMembersOpts<SubM>
			: never;
};

interface _BindEnvironmentInputBase<M extends Readonly<Record<string, EnvMember>>> {
	readonly env: Environment<M>;
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
	 * staging / local) without redeclaring each contract. Recurses into
	 * nested `Environment` members.
	 */
	readonly namespace?: string;
}

/**
 * `secrets` flips between required and optional based on whether `M`
 * actually contains any secrets. A bundle of literals/downwards only
 * has nothing to bind, so `secrets` stays optional. A bundle with even
 * one `defineSecret` (directly or nested) forces the caller to supply
 * every secret member — and for each member, either a `backend` or a
 * `source` (see `SecretMemberOptions`).
 */
export type BindEnvironmentInput<M extends Readonly<Record<string, EnvMember>>> =
	_BindEnvironmentInputBase<M> &
		(HasSecrets<M> extends true
			? { readonly secrets: SecretMembersOpts<M> }
			: { readonly secrets?: SecretMembersOpts<M> });

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
	const { env } = input;
	const declared: Record<string, unknown> = {};
	const envVars: EnvVar[] = [];
	const manifests: Manifest.Manifest<unknown>[] = [];
	const valuesLayers: Layer.Layer<unknown, RenderError, Manifest.RenderServices>[] = [];
	const secretsOpts = coerce<Record<string, unknown> | undefined>(input.secrets);
	const literalsOpts = coerce<Record<string, unknown> | undefined>(input.literals);

	for (const memberKey of Object.keys(env.members)) {
		const entry = coerce<EnvMember>(env.members[memberKey]);
		if (entry._kind === "Secret") {
			const memberOpts = coerce<SecretMemberOptions<string, string> | undefined>(
				secretsOpts?.[memberKey],
			);
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
			const d = _bindLiteral({ entry, override: literalsOpts?.[memberKey] });
			declared[memberKey] = d;
			envVars.push(d.envVar);
		} else if (entry._kind === "Downward") {
			const d = _bindDownward({ entry });
			declared[memberKey] = d;
			envVars.push(d.envVar);
		} else {
			// Nested Environment — recurse with the matching sub-overrides.
			const subEnv = coerce<AnyEnvironment>(entry);
			const sub = bindEnvironment({
				env: subEnv,
				secrets: coerce<SecretMembersOpts<Readonly<Record<string, EnvMember>>>>(
					secretsOpts?.[memberKey] ?? {},
				),
				literals: coerce<LiteralMembersOpts<Readonly<Record<string, EnvMember>>>>(
					literalsOpts?.[memberKey] ?? {},
				),
				namespace: input.namespace,
			});
			// Recursive declared sub-record matches DeclaredMember<Environment<...>>.
			declared[memberKey] = sub.members;
			envVars.push(...sub.envVars);
			manifests.push(...sub.manifests);
			valuesLayers.push(
				coerce<Layer.Layer<unknown, RenderError, Manifest.RenderServices>>(sub.valuesLayer),
			);
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
