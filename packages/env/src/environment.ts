import { Config } from "effect";
import {
	type EnvClaim,
	type EntryMarker,
	type HasEnvClaims,
	EnvNameCollision,
	_makeEntry,
} from "./entry";
import type { AnyDownwardEntry, DownwardEntry } from "./downward";
import type { AnyLiteralEntry, LiteralEntry } from "./literal";
import type { AnySecretEntry, SecretEntry } from "./secret";

/**
 * Union of every kind that can be a member of a `defineEnvironment`.
 *
 * Nesting: `Environment` itself is a valid `EnvMember`, so bundles can
 * group related secrets / literals / downward fields into sub-records.
 * The yielded record matches the nesting structure — e.g. `env.db.host`,
 * `env.db.password` for a bundle `{db: defineEnvironment({host, password})}`.
 * `Environment.bind` walks nested groups recursively when emitting
 * envVars + secret manifests, and `SecretMembersOpts` / `LiteralMembersOpts`
 * accept matching nested override shapes.
 */
export type EnvMember =
	| AnySecretEntry
	| AnyLiteralEntry
	| AnyDownwardEntry
	| AnyEnvironment;

export type MemberValue<A> = A extends Config.Config<infer T> ? T : never;

export interface Environment<M extends Readonly<Record<string, EnvMember>>>
	extends Config.Config<{ readonly [K in keyof M]: MemberValue<M[K]> }>,
		EntryMarker<"Environment">,
		HasEnvClaims {
	readonly members: M;
}

// oxlint-disable-next-line app/no-explicit-any
export type AnyEnvironment = Environment<Readonly<Record<string, any>>>;

// oxlint-disable-next-line app/no-type-assertion
const _cast = <T>(value: unknown): T => value as T;

const _collectClaims = (
	members: Readonly<Record<string, EnvMember>>,
): ReadonlyArray<EnvClaim> => {
	const byEnvName = new Map<string, string[]>();
	const out: EnvClaim[] = [];
	for (const [, entry] of Object.entries(members)) {
		for (const claim of entry.envClaims) {
			const prior = byEnvName.get(claim.envName);
			if (prior === undefined) {
				byEnvName.set(claim.envName, [claim.label]);
			} else {
				prior.push(claim.label);
			}
			out.push(claim);
		}
	}
	for (const [envName, labels] of byEnvName) {
		if (labels.length > 1) {
			throw new EnvNameCollision({ envName, claims: labels });
		}
	}
	return out;
};

/**
 * Compile-time envName collision check (best-effort, complements the
 * runtime throw).
 *
 * Each member exposes a union of the envNames it claims. For every
 * key K in M, we compare K's envName union against the union claimed
 * by all *other* members; a non-empty intersection means a collision.
 * The check stops at the top-level members of M — nested `Environment`
 * members are not walked into here. The runtime `_collectClaims`
 * catches every collision, including cross-nesting ones; the type
 * check is just the early-warning layer.
 */
type _EnvNamesOfMember<E> = E extends SecretEntry<
	infer _N,
	infer _K,
	infer Envs
>
	? Envs extends Readonly<Record<string, infer V extends string>>
		? V
		: never
	: E extends LiteralEntry<infer EnvName, infer _T>
		? EnvName
		: E extends DownwardEntry<infer EnvName>
			? EnvName
			: never;

type _OthersEnvNames<
	M extends Readonly<Record<string, EnvMember>>,
	K extends keyof M,
> = {
	[Other in keyof M]: Other extends K ? never : _EnvNamesOfMember<M[Other]>;
}[keyof M];

type _CollisionForKey<
	M extends Readonly<Record<string, EnvMember>>,
	K extends keyof M,
> = Extract<_EnvNamesOfMember<M[K]>, _OthersEnvNames<M, K>>;

type _AnyCollision<M extends Readonly<Record<string, EnvMember>>> = {
	[K in keyof M]: _CollisionForKey<M, K>;
}[keyof M];

type _EnvNameCollisionError<Name extends string> = {
	readonly _konfig_error: `defineEnvironment: envName "${Name}" is claimed by multiple members`;
};

type _CheckCollisions<M extends Readonly<Record<string, EnvMember>>> = [
	_AnyCollision<M>,
] extends [never]
	? M
	: _EnvNameCollisionError<Extract<_AnyCollision<M>, string>>;

export const defineEnvironment = <const M extends Readonly<Record<string, EnvMember>>>(
	members: M & _CheckCollisions<M>,
): Environment<M> => {
	const envClaims = _collectClaims(members);

	const root = _cast<
		Config.Config<{
			readonly [K in keyof M]: MemberValue<M[K]>;
		}>
	>(Config.all(members));

	return _makeEntry({
		config: root,
		metadata: {
			_kind: "Environment" as const,
			members,
			envClaims,
		},
	});
};
