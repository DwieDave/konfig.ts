import { unsafeCoerce } from "@konfig.ts/core";
import type { SecretSource } from "@konfig.ts/env";
import { SecretSourceError } from "@konfig.ts/env";
import { Effect, Redacted, type Scope } from "effect";
import * as YAML from "yaml";
import type { ChildProcessSpawner } from "./_unstable";
import { sopsDecrypt } from "./sops";

export interface SopsSourceInput<K extends string> {
	readonly file: string;
	readonly keys: ReadonlyArray<K>;
	/**
	 * Path resolver for the parsed plaintext object. Default is
	 * `(k) => k`, i.e. flat record `{key: value}`. Supply a custom
	 * resolver if the encrypted YAML nests keys.
	 */
	readonly extract?: (key: K, parsed: unknown) => unknown;
}

const _defaultExtract = (key: string, parsed: unknown): unknown => {
	if (parsed === null || typeof parsed !== "object") return undefined;
	return unsafeCoerce<Record<string, unknown>>(
		parsed,
		"typeof === object branch above narrows parsed to a non-null object; index access yields unknown",
	)[key];
};

/**
 * Decrypt the file ONCE, parse the resulting YAML, and pluck every
 * requested key from the in-memory plaintext. Replaces the prior
 * per-key `sopsExtract` loop which invoked `sops --decrypt --extract`
 * N times for N keys.
 */
const _source = <const K extends string>(
	input: SopsSourceInput<K>,
): SecretSource<K, ChildProcessSpawner | Scope.Scope> => {
	const extract = input.extract ?? _defaultExtract;
	const resolve = Effect.gen(function* () {
		const decryptedYaml = yield* sopsDecrypt({ file: input.file }).pipe(
			Effect.mapError(
				(cause) => new SecretSourceError({ source: "Sops", key: input.file, cause }),
			),
		);
		const parsed = yield* Effect.try({
			try: (): unknown => YAML.parse(decryptedYaml),
			catch: (cause) =>
				new SecretSourceError({ source: "Sops", key: input.file, cause }),
		});
		const out: Record<string, Redacted.Redacted<string>> = {};
		for (const key of input.keys) {
			const value = extract(key, parsed);
			if (typeof value !== "string") {
				return yield* Effect.fail(
					new SecretSourceError({
						source: "Sops",
						key,
						cause: `extracted value for "${key}" is not a string`,
					}),
				);
			}
			out[key] = Redacted.make(value);
		}
		return unsafeCoerce<{ readonly [P in K]: Redacted.Redacted<string> }>(
			out,
			"out was populated by iterating over input.keys: ReadonlyArray<K>, so every K is present",
		);
	});
	return { _tag: "SecretSource", keys: input.keys, resolve };
};

export const SopsSource = { source: _source };
