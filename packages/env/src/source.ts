import { Config, Data, Effect, type Scope, Redacted } from "effect";
import { ChildProcess } from "effect/unstable/process";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";

export class SecretSourceError extends Data.TaggedError("SecretSourceError")<{
	readonly source: string;
	readonly key: string;
	readonly cause: unknown;
}> {}

export type ResolvedSecretValues<K extends string> = {
	readonly [P in K]: Redacted.Redacted<string>;
};

export interface SecretSource<K extends string, R = never> {
	readonly _tag: "SecretSource";
	readonly keys: ReadonlyArray<K>;
	readonly resolve: Effect.Effect<ResolvedSecretValues<K>, SecretSourceError, R>;
}

export interface FromConfigInput<K extends string> {
	readonly keys: ReadonlyArray<K>;
	readonly envName?: (key: K) => string;
}

// oxlint-disable-next-line app/no-type-assertion
const _cast = <T>(value: unknown): T => value as T;

const _fromConfig = <const K extends string>(input: FromConfigInput<K>): SecretSource<K> => {
	const envName = input.envName ?? ((k: K) => k);
	const resolve = Effect.gen(function* () {
		const out: Record<string, Redacted.Redacted<string>> = {};
		for (const key of input.keys) {
			const v = yield* Config.redacted(envName(key)).asEffect().pipe(
				Effect.mapError(
					(cause) => new SecretSourceError({ source: "fromConfig", key, cause }),
				),
			);
			out[key] = v;
		}
		return _cast<ResolvedSecretValues<K>>(out);
	});
	return { _tag: "SecretSource", keys: input.keys, resolve };
};

export interface LiteralInput<D extends Readonly<Record<string, string>>> {
	readonly data: D;
}

const _literal = <const D extends Readonly<Record<string, string>>>(
	input: LiteralInput<D>,
): SecretSource<keyof D & string> => {
	const keys = _cast<Array<keyof D & string>>(Object.keys(input.data));
	const resolve = Effect.sync(() => {
		const out: Record<string, Redacted.Redacted<string>> = {};
		for (const k of keys) {
			out[k] = Redacted.make(input.data[k]);
		}
		return _cast<ResolvedSecretValues<keyof D & string>>(out);
	});
	return { _tag: "SecretSource", keys, resolve };
};

export interface FromCommandSpec {
	readonly cmd: string;
	readonly args: ReadonlyArray<string>;
}

export interface FromCommandInput<K extends string> {
	readonly keys: ReadonlyArray<K>;
	readonly run: (key: K) => FromCommandSpec;
}

const _fromCommand = <const K extends string>(
	input: FromCommandInput<K>,
): SecretSource<K, ChildProcessSpawner | Scope.Scope> => {
	const resolve = Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner;
		const out: Record<string, Redacted.Redacted<string>> = {};
		for (const key of input.keys) {
			const spec = input.run(key);
			const proc = ChildProcess.make(spec.cmd, [...spec.args]);
			const stdout = yield* spawner
				.string(proc)
				.pipe(
					Effect.mapError(
						(cause) => new SecretSourceError({ source: "fromCommand", key, cause }),
					),
				);
			out[key] = Redacted.make(stdout.replace(/\n+$/u, ""));
		}
		return _cast<ResolvedSecretValues<K>>(out);
	}).pipe(Effect.scoped);
	return { _tag: "SecretSource", keys: input.keys, resolve };
};

export const SecretSource = {
	fromConfig: _fromConfig,
	literal: _literal,
	fromCommand: _fromCommand,
};
