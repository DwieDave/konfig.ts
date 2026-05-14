// Render an env's Applications to per-file YAML on disk. Used by
// `konfig build`, `konfig validate`, and (read-only) `konfig diff`.

import {
	type AppOfAppsResult,
	applicationCRFilename,
	serializeApplicationCR,
} from "@konfig.ts/argocd";
import {
	type AnyRenderError,
	type Manifest as M,
	parseYaml,
	type RenderContext,
	type ResolvedKonfigConfig,
	render,
	Yaml,
} from "@konfig.ts/core";
import { Data, Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";

export class EnvEntryNotFound extends Data.TaggedError("EnvEntryNotFound")<{
	readonly env: string;
	readonly entry: string;
}> {}

export class EnvLoadError extends Data.TaggedError("EnvLoadError")<{
	readonly entry: string;
	readonly cause: unknown;
}> {}

// Resolve the env entry file's absolute path from the resolved config.
const resolveEnvEntry = (cfg: ResolvedKonfigConfig, envName: string) =>
	Effect.gen(function* () {
		const path = yield* Path;
		const fs = yield* FileSystem;

		const envSpec = cfg.config.envs[envName];
		const entry =
			envSpec === undefined
				? path.join(cfg.configDir, cfg.config.root, "env", `${envName}.ts`)
				: path.join(cfg.configDir, cfg.config.root, envSpec.entry);

		const exists = yield* fs.exists(entry).pipe(Effect.orElseSucceed(() => false));
		if (!exists) {
			return yield* Effect.fail(new EnvEntryNotFound({ env: envName, entry }));
		}
		return entry;
	});

// Dynamic-import the env file and run its default-exported Effect to get the
// `AppOfAppsResult`. The env entry exports `default = Effect<AppOfApps...>`.
const loadEnv = (entry: string) =>
	Effect.gen(function* () {
		const mod = yield* Effect.tryPromise({
			try: () => import(entry),
			catch: (cause) => new EnvLoadError({ entry, cause }),
		});
		const program = (mod as { default?: unknown }).default;
		if (program === undefined) {
			return yield* Effect.fail(new EnvLoadError({ entry, cause: "default export is missing" }));
		}
		// The env entry's default export is an Effect that yields an AppOfAppsResult.
		const result = yield* program as Effect.Effect<AppOfAppsResult, AnyRenderError>;
		return result;
	});

// One file destined for disk — either a typed k8s resource, raw YAML
// (from `Helm.release` / `embedYaml`), or an Application CR.
interface OutputFile {
	readonly path: string;
	readonly content: string;
}

// Split a multi-doc RawYaml content into individual `<Kind>-<name>.yaml`
// files. Each doc is parsed once to extract kind+name for the filename
// (via `Yaml.filenameFor` so dots in names are sanitized identically to
// the typed-resource path below).
const splitRawYaml = (
	content: string,
	dir: string,
	pathSep: (...parts: string[]) => string,
): OutputFile[] => {
	const docs = content.split(/^---$/m);
	const files: OutputFile[] = [];
	for (const doc of docs) {
		const trimmed = doc.trim();
		if (trimmed.length === 0) continue;
		const parsed = parseYaml(trimmed) as { kind?: string; metadata?: { name?: string } } | null;
		if (parsed === null || typeof parsed !== "object") continue;
		const kind = parsed.kind;
		const name = parsed.metadata?.name;
		if (typeof kind !== "string" || typeof name !== "string") continue;
		// Re-emit through the stable serializer so the on-disk output follows
		// the FR-2 key-order rules regardless of helm's output ordering.
		files.push({
			path: pathSep(dir, Yaml.filenameFor({ kind, metadata: { name } })),
			content: Yaml.serialize(parsed),
		});
	}
	return files;
};

// Render one manifest-tree value (possibly a tuple, possibly RawYaml,
// possibly a single k8s resource) into one or more OutputFiles under
// `appDir`. Walks the structure recursively because `combine` produces
// `readonly [A1, A2]` tuples.
const collectOutputs = (
	value: unknown,
	appDir: string,
	pathJoin: (...parts: string[]) => string,
): OutputFile[] => {
	if (value === null || value === undefined) return [];

	// RawYaml from Helm / embedYaml — may carry multiple docs in `content`.
	if (
		typeof value === "object" &&
		value !== null &&
		(value as { _tag?: unknown })._tag === "RawYaml"
	) {
		const raw = value as { content: string };
		return splitRawYaml(raw.content, appDir, pathJoin);
	}

	// Array (RawYaml[] from Helm.release, or readonly tuple from combine).
	if (Array.isArray(value)) {
		return value.flatMap((v) => collectOutputs(v, appDir, pathJoin));
	}

	// Typed k8s resource — must have kind + metadata.name.
	if (typeof value === "object") {
		const obj = value as { kind?: unknown; metadata?: { name?: unknown } };
		if (typeof obj.kind === "string" && typeof obj.metadata?.name === "string") {
			return [
				{
					path: pathJoin(
						appDir,
						Yaml.filenameFor({ kind: obj.kind, metadata: { name: obj.metadata.name } }),
					),
					content: Yaml.serialize(obj),
				},
			];
		}
	}

	return [];
};

export interface RenderedEnv {
	readonly appsDirAbs: string;
	readonly outDirAbs: string;
	readonly files: ReadonlyArray<OutputFile>;
}

// Render one env: load the entrypoint, evaluate it, walk the Application
// tree, and return the list of files that need to be written. The
// caller decides whether to write them (build) or compare against an
// existing tree (diff) or just stop (validate).
export const renderEnv = (cfg: ResolvedKonfigConfig, envName: string, ctx: RenderContext) =>
	Effect.gen(function* () {
		const path = yield* Path;
		const entry = yield* resolveEnvEntry(cfg, envName);
		const result = yield* loadEnv(entry);

		const outDirAbs = path.join(
			cfg.configDir,
			cfg.config.root,
			cfg.config.outDir.manifests,
			envName,
		);
		const appsDirAbs = path.join(outDirAbs, result.name);
		const files: OutputFile[] = [];

		for (const app of result.apps) {
			const appDir = path.join(outDirAbs, app.name);
			// The app's manifests render in parallel via Effect.all. M9
			// dropped the per-Manifest R/P; dep satisfaction is now enforced
			// by Effect's R at the surrounding `runPromise` call, not by a
			// type-level constraint on `render`.
			type AnyManifest = M.Manifest<unknown>;
			const rendered = yield* Effect.all(
				app.manifests.map((m) => render(m as AnyManifest, ctx)),
				{ concurrency: "unbounded" },
			);
			for (const value of rendered) {
				files.push(...collectOutputs(value, appDir, path.join));
			}

			// Per FR-6.5, each Application gets one CR in `apps/`.
			files.push({
				path: path.join(appsDirAbs, applicationCRFilename(app)),
				content: serializeApplicationCR(app, result.target, result.defaults),
			});
		}

		return { appsDirAbs, outDirAbs, files } as RenderedEnv;
	}).pipe(Effect.scoped);

export class WriteEnvError extends Data.TaggedError("WriteEnvError")<{
	readonly path: string;
	readonly cause: unknown;
}> {}

// Write `files` to disk, replacing any pre-existing `outDirAbs`. Returns
// the list of paths written for logging.
export const writeFiles = (
	rendered: RenderedEnv,
): Effect.Effect<ReadonlyArray<string>, WriteEnvError, FileSystem | Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const path = yield* Path;

		// Wipe the env tree for an idempotent build. Per FR-2.5 the layout is
		// `<env>/<App>/<Kind>-<name>.yaml`, so removing the env root is safe.
		const exists = yield* fs.exists(rendered.outDirAbs).pipe(Effect.orElseSucceed(() => false));
		if (exists) {
			yield* fs
				.remove(rendered.outDirAbs, { recursive: true })
				.pipe(Effect.mapError((cause) => new WriteEnvError({ path: rendered.outDirAbs, cause })));
		}

		const written: string[] = [];
		for (const file of rendered.files) {
			yield* fs
				.makeDirectory(path.dirname(file.path), { recursive: true })
				.pipe(Effect.mapError((cause) => new WriteEnvError({ path: file.path, cause })));
			yield* fs
				.writeFileString(file.path, file.content)
				.pipe(Effect.mapError((cause) => new WriteEnvError({ path: file.path, cause })));
			written.push(file.path);
		}
		return written;
	});
