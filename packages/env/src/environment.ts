import { Config } from "effect";
import {
	type EnvClaim,
	type EntryMarker,
	type HasEnvClaims,
	EnvNameCollision,
	_makeEntry,
} from "./entry";
import type { AnyDownwardEntry } from "./downward";
import type { AnyLiteralEntry } from "./literal";
import type { AnySecretEntry } from "./secret";

export type EnvMember = AnySecretEntry | AnyLiteralEntry | AnyDownwardEntry;

export type MemberValue<A> = A extends Config.Config<infer T> ? T : never;

export interface Environment<M extends Readonly<Record<string, EnvMember>>>
	extends Config.Config<{ readonly [K in keyof M]: MemberValue<M[K]> }>,
		EntryMarker<"Environment">,
		HasEnvClaims {
	readonly members: M;
}

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

export const defineEnvironment = <const M extends Readonly<Record<string, EnvMember>>>(
	members: M,
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
