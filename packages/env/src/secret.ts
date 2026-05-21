import { Config, type Redacted } from "effect";
import {
	type EnvClaim,
	type EntryMarker,
	type HasEnvClaims,
	_makeEntry,
} from "./entry";

export interface SecretEntry<
	N extends string,
	K extends string,
	E extends Readonly<Record<K, string>>,
> extends Config.Config<{ readonly [P in K]: Redacted.Redacted<string> }>,
		EntryMarker<"Secret">,
		HasEnvClaims {
	readonly name: N;
	readonly namespace: string;
	readonly env: E;
	readonly keys: ReadonlyArray<K>;
	readonly fields: { readonly [P in K]: Config.Config<Redacted.Redacted<string>> };
}

export interface DefineSecretInput<
	N extends string,
	E extends Readonly<Record<string, string>>,
> {
	readonly name: N;
	readonly namespace: string;
	readonly env: E;
}

// oxlint-disable-next-line app/no-type-assertion
const _cast = <T>(value: unknown): T => value as T;

export const defineSecret = <
	const N extends string,
	const E extends Readonly<Record<string, string>>,
>(
	input: DefineSecretInput<N, E>,
): SecretEntry<N, keyof E & string, E> => {
	const keys = _cast<Array<keyof E & string>>(Object.keys(input.env));

	const fields: Record<string, Config.Config<Redacted.Redacted<string>>> = {};
	for (const key of keys) {
		fields[key] = Config.redacted(input.env[key]);
	}

	const root = _cast<
		Config.Config<{
			readonly [P in keyof E & string]: Redacted.Redacted<string>;
		}>
	>(Config.all(fields));

	const envClaims: ReadonlyArray<EnvClaim> = keys.map((key) => ({
		envName: input.env[key],
		label: `Secret(${input.name}).${key}`,
	}));

	return _makeEntry({
		config: root,
		metadata: {
			_kind: "Secret" as const,
			name: input.name,
			namespace: input.namespace,
			env: input.env,
			keys,
			fields: _cast<{
				readonly [P in keyof E & string]: Config.Config<Redacted.Redacted<string>>;
			}>(fields),
			envClaims,
		},
	});
};

export type AnySecretEntry = SecretEntry<string, string, Readonly<Record<string, string>>>;
