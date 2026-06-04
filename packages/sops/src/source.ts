import { coerce } from "@konfig.ts/core";
import type { SecretSource } from "@konfig.ts/env";
import { SecretSourceError } from "@konfig.ts/env";
import { Effect, Redacted, type Scope } from "effect";
import type { ChildProcessSpawner } from "./_unstable";
import { sopsExtract } from "./sops";

export interface SopsSourceInput<K extends string> {
	readonly file: string;
	readonly keys: ReadonlyArray<K>;
	readonly extract?: (key: K) => string;
}

const _source = <const K extends string>(
	input: SopsSourceInput<K>,
): SecretSource<K, ChildProcessSpawner | Scope.Scope> => {
	const extract = input.extract ?? ((k: K) => `["${k}"]`);
	const resolve = Effect.gen(function* () {
		const out: Record<string, Redacted.Redacted<string>> = {};
		for (const key of input.keys) {
			const value = yield* sopsExtract({
				file: input.file,
				extract: extract(key),
			}).pipe(
				Effect.mapError(
					(cause) => new SecretSourceError({ source: "Sops", key, cause }),
				),
			);
			out[key] = Redacted.make(value);
		}
		return coerce<{ readonly [P in K]: Redacted.Redacted<string> }>(out);
	});
	return { _tag: "SecretSource", keys: input.keys, resolve };
};

export const SopsSource = { source: _source };
