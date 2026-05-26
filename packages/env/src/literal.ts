import { Config } from "effect";
import {
	type EnvClaim,
	type EntryMarker,
	type HasEnvClaims,
	_makeEntry,
} from "./entry";

export interface LiteralEntry<EnvName extends string, T>
	extends Config.Config<T>,
		EntryMarker<"Literal">,
		HasEnvClaims {
	readonly envName: EnvName;
	readonly value: T;
	readonly serialized: string;
	/**
	 * Stored so bind-time value overrides can re-serialize with the same
	 * fn. Typed as `(unknown) => string` so that `LiteralEntry<…, T>`
	 * stays assignable to `LiteralEntry<string, unknown>` in the
	 * `EnvMember` union (function params are contravariant — a more
	 * specific T would block the narrowing). The override site supplies
	 * a value typed against `T` via `LiteralMembersOpts<M>`.
	 */
	readonly serialize: (value: unknown) => string;
}

export interface DefineLiteralInput<EnvName extends string, T> {
	readonly envName: EnvName;
	readonly value: T;
	readonly schema?: Config.Config<T>;
	readonly serialize?: (value: T) => string;
}

// oxlint-disable-next-line app/no-type-assertion
const _cast = <T>(value: unknown): T => value as T;

export const defineLiteral = <const EnvName extends string, T = string>(
	input: DefineLiteralInput<EnvName, T>,
): LiteralEntry<EnvName, T> => {
	const userSerialize = input.serialize ?? ((v: T) => String(v));
	// Erase the parameter type to `unknown` for the stored function — see
	// the LiteralEntry doc for the variance rationale. defineLiteral's
	// own type signature still enforces `T` at the user-facing call site.
	const serialize = (value: unknown): string => userSerialize(_cast<T>(value));
	const serialized = userSerialize(input.value);

	const parser =
		input.schema !== undefined ? input.schema : _cast<Config.Config<T>>(Config.succeed(input.value));

	const envClaims: ReadonlyArray<EnvClaim> = [
		{ envName: input.envName, label: `Literal(${input.envName})` },
	];

	return _makeEntry({
		config: parser,
		metadata: {
			_kind: "Literal" as const,
			envName: input.envName,
			value: input.value,
			serialized,
			serialize,
			envClaims,
		},
	});
};

export type AnyLiteralEntry = LiteralEntry<string, unknown>;
