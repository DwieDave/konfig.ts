// T4.2 — `konfig.json` config resolution.
//
// Walks up from `cwd` until it finds a `konfig.json`, decodes it through the
// strict `decodeKonfigConfigEffect` from `@konfig.ts/core`, and returns the resolved
// config + the directory it lives in. Every path in the config is
// interpreted relative to `configDir`.

import { decodeKonfigConfigEffect, type ResolvedKonfigConfig, type KonfigConfig } from "@konfig.ts/core";
import { Data, Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";

export class ConfigNotFound extends Data.TaggedError("ConfigNotFound")<{
	readonly startedFrom: string;
}> {}

export class ConfigParseError extends Data.TaggedError("ConfigParseError")<{
	readonly path: string;
	readonly cause: unknown;
}> {}

// Walk the parent chain from `start` looking for a `konfig.json`. Returns the
// absolute path of the first hit, or `ConfigNotFound` if we reach the root.
// FS errors during the `exists` checks are treated as "not present here" —
// the walk continues — so missing-permission directories don't abort search.
const findConfig = (start: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const path = yield* Path;

		let current = path.resolve(start);
		while (true) {
			const candidate = path.join(current, "konfig.json");
			const exists = yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false));
			if (exists) return candidate;
			const parent = path.dirname(current);
			if (parent === current) {
				return yield* Effect.fail(new ConfigNotFound({ startedFrom: start }));
			}
			current = parent;
		}
	});

// Decode the file contents. All failures (read errors, JSON syntax, schema
// validation) surface as `ConfigParseError` with the underlying cause —
// callers don't need to disambiguate which step failed.
const parseConfig = (configPath: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const text = yield* fs
			.readFileString(configPath)
			.pipe(Effect.mapError((cause) => new ConfigParseError({ path: configPath, cause })));
		const parsed = yield* Effect.try({
			try: () => JSON.parse(text) as unknown,
			catch: (cause) => new ConfigParseError({ path: configPath, cause }),
		});
		return yield* decodeKonfigConfigEffect(parsed).pipe(
			Effect.mapError((cause) => new ConfigParseError({ path: configPath, cause })),
		);
	});

// Public API: resolve the config starting from a directory (defaults to cwd
// at evaluation time). Returns the validated config plus the directory
// containing `konfig.json` — consumers join their relative paths against it.
export const resolveConfig = (
	from?: string,
): Effect.Effect<ResolvedKonfigConfig, ConfigNotFound | ConfigParseError, FileSystem | Path> =>
	Effect.gen(function* () {
		const path = yield* Path;
		const start = from ?? process.cwd();
		const configPath = yield* findConfig(start);
		const config: KonfigConfig = yield* parseConfig(configPath);
		const configDir = path.dirname(configPath);
		return { configDir, config };
	});
