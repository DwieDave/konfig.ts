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
	const serialized =
		input.serialize !== undefined ? input.serialize(input.value) : String(input.value);

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
			envClaims,
		},
	});
};

export type AnyLiteralEntry = LiteralEntry<string, unknown>;
