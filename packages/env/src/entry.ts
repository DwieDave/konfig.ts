import type { Config } from "effect";
import { Data } from "effect";

export type EntryKind = "Secret" | "Literal" | "Downward" | "Environment";

export interface EntryMarker<K extends EntryKind> {
	readonly _kind: K;
}

export class EnvNameCollision extends Data.TaggedError("EnvNameCollision")<{
	readonly envName: string;
	readonly claims: ReadonlyArray<string>;
}> {
	get message(): string {
		return `environment variable name "${this.envName}" is claimed by multiple entries: ${this.claims
			.map((c) => `"${c}"`)
			.join(", ")}`;
	}
}

export interface EnvClaim {
	readonly envName: string;
	readonly label: string;
}

export interface HasEnvClaims {
	readonly envClaims: ReadonlyArray<EnvClaim>;
}

export interface MakeEntryInput<C extends Config.Config<unknown>, M extends object> {
	readonly config: C;
	readonly metadata: M;
}

// oxlint-disable-next-line app/no-type-assertion
const _cast = <T>(value: unknown): T => value as T;

// Each Secret/Literal/Downward produces a yieldable
// Config (an "atom" in state-management terms) intersected with its pure
// metadata. _makeEntry is the internal helper that does the merge.
export const _makeEntry = <C extends Config.Config<unknown>, M extends object>(
	input: MakeEntryInput<C, M>,
): C & M => _cast<C & M>(Object.assign(input.config, input.metadata));
