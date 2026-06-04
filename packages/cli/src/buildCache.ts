import * as crypto from "node:crypto";
import type { ResolvedKonfigConfig } from "@konfig.ts/core";
import { unsafeCoerce } from "@konfig.ts/core";
import { Data, Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";

export class BuildCacheError extends Data.TaggedError("BuildCacheError")<{
	readonly path: string;
	readonly cause: unknown;
}> {}

export interface BuildCacheEntry {
	readonly inputHash: string;
	readonly outputHash: string;
	readonly outDirAbs: string;
	readonly fileCount: number;
	readonly timestamp: string;
}

interface ComputeInputHashInput {
	readonly cfg: ResolvedKonfigConfig;
	readonly envName: string;
}

/**
 * Compute a SHA-256 over the inputs that could feed an env's render:
 *  - The env's entry file content (resolved per `cfg.config.envs[env]`
 *    or `<root>/env/<env>.ts`).
 *  - Every `.ts` / `.json` file under `cfg.config.root` (sorted by
 *    path so the hash is deterministic across runs).
 *  - The konfig.json contents (via `cfg.config` serialized).
 *
 * The hash is conservative — touching any TS file under the env root
 * invalidates the cache. False negatives only; never a false positive.
 */
export const computeInputHash = (input: ComputeInputHashInput) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const path = yield* Path;
		const { cfg, envName } = input;

		const hash = crypto.createHash("sha256");
		hash.update(JSON.stringify(cfg.config));
		hash.update("\n");

		const envSpec = cfg.config.envs[envName];
		const entry =
			envSpec === undefined
				? path.join(cfg.configDir, cfg.config.root, "env", `${envName}.ts`)
				: path.join(cfg.configDir, cfg.config.root, envSpec.entry);
		const entryExists = yield* fs.exists(entry).pipe(Effect.orElseSucceed(() => false));
		if (entryExists) {
			const content = yield* fs.readFileString(entry).pipe(Effect.orElseSucceed(() => ""));
			hash.update(`entry:${entry}\n`);
			hash.update(content);
			hash.update("\n");
		}

		const rootAbs = path.join(cfg.configDir, cfg.config.root);
		const files: string[] = [];
		yield* _collectFiles(rootAbs, files);
		files.sort();
		for (const f of files) {
			const content = yield* fs.readFileString(f).pipe(Effect.orElseSucceed(() => ""));
			hash.update(`file:${f}\n`);
			hash.update(content);
			hash.update("\n");
		}

		return hash.digest("hex");
	});

const _collectFiles = (
	dir: string,
	out: string[],
): Effect.Effect<void, never, FileSystem | Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const path = yield* Path;
		const entries = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => [] as string[]));
		for (const e of entries) {
			const full = path.join(dir, e);
			const stat = yield* fs.stat(full).pipe(Effect.orElseSucceed(() => null));
			if (stat === null) continue;
			if (stat.type === "Directory") {
				if (e === "node_modules" || e === "dist" || e === ".konfig") continue;
				yield* _collectFiles(full, out);
			} else if (stat.type === "File") {
				if (e.endsWith(".ts") || e.endsWith(".json") || e.endsWith(".yaml") || e.endsWith(".yml")) {
					out.push(full);
				}
			}
		}
	});

/**
 * Hash a list of (path, content) pairs deterministically. Used to
 * fingerprint the rendered output so the next build can detect
 * out-of-band tampering with the output tree.
 */
export const computeOutputHash = (
	files: ReadonlyArray<{ readonly path: string; readonly content: string }>,
): string => {
	const hash = crypto.createHash("sha256");
	const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	for (const f of sorted) {
		hash.update(`${f.path}\n`);
		hash.update(f.content);
		hash.update("\n");
	}
	return hash.digest("hex");
};

const _cacheFilePath = (cfg: ResolvedKonfigConfig, envName: string, joinFn: (...parts: string[]) => string): string =>
	joinFn(cfg.configDir, ".konfig", "cache", `${envName}.json`);

interface ReadEntryInput {
	readonly cfg: ResolvedKonfigConfig;
	readonly envName: string;
}

export const readCacheEntry = (input: ReadEntryInput) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const path = yield* Path;
		const cacheFile = _cacheFilePath(input.cfg, input.envName, path.join);
		const exists = yield* fs.exists(cacheFile).pipe(Effect.orElseSucceed(() => false));
		if (!exists) return undefined;
		const text = yield* fs.readFileString(cacheFile).pipe(Effect.orElseSucceed(() => ""));
		if (text === "") return undefined;
		try {
			const parsed = JSON.parse(text);
			return unsafeCoerce<BuildCacheEntry>(
				parsed,
				"parsed JSON shape matches BuildCacheEntry — caller revalidates by recomputing inputHash",
			);
		} catch {
			return undefined;
		}
	});

interface WriteEntryInput {
	readonly cfg: ResolvedKonfigConfig;
	readonly envName: string;
	readonly entry: BuildCacheEntry;
}

export const writeCacheEntry = (input: WriteEntryInput) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const path = yield* Path;
		const cacheFile = _cacheFilePath(input.cfg, input.envName, path.join);
		const dir = path.dirname(cacheFile);
		yield* fs
			.makeDirectory(dir, { recursive: true })
			.pipe(Effect.mapError((cause) => new BuildCacheError({ path: dir, cause })));
		yield* fs
			.writeFileString(cacheFile, `${JSON.stringify(input.entry, null, 2)}\n`)
			.pipe(Effect.mapError((cause) => new BuildCacheError({ path: cacheFile, cause })));
	});
