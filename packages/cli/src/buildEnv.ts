
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
	unsafeCoerce,
	Yaml,
} from "@konfig.ts/core";
import type { Bundle } from "@konfig.ts/k8s";
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

interface _ResolveEnvEntryInput {
	readonly cfg: ResolvedKonfigConfig;
	readonly envName: string;
}
const _resolveEnvEntry = (input: _ResolveEnvEntryInput) =>
	Effect.gen(function* () {
		const { cfg, envName } = input;
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

type EnvResult = AppOfAppsResult | Bundle.BundleSetResult;

const _isAppOfApps = (r: EnvResult): r is AppOfAppsResult =>
	unsafeCoerce<{ apps?: unknown }>(r, "discriminator probe — reads optional `apps` to tell the argo shape apart from the bundle shape").apps !== undefined;

const _loadEnv = (entry: string) =>
	Effect.gen(function* () {
		const mod = yield* Effect.tryPromise({
			try: () => import(entry),
			catch: (cause) => new EnvLoadError({ entry, cause }),
		});
		const program = unsafeCoerce<{ default?: unknown }>(mod, "imported module is a plain JS object").default;
		if (program === undefined) {
			return yield* Effect.fail(new EnvLoadError({ entry, cause: "default export is missing" }));
		}
		const result = yield* unsafeCoerce<Effect.Effect<EnvResult, AnyRenderError>>(
			program,
			"env entry default export is either an AppOfApps or Bundle program Effect — contract documented in core/README.md",
		);
		return result;
	});

interface OutputFile {
	readonly path: string;
	readonly content: string;
}

interface _SplitRawYamlInput {
	readonly content: string;
	readonly dir: string;
	readonly pathSep: (...parts: string[]) => string;
}
const _splitRawYaml = (input: _SplitRawYamlInput): OutputFile[] => {
	const { content, dir, pathSep } = input;
	const docs = content.split(/^---$/m);
	const files: OutputFile[] = [];
	for (const doc of docs) {
		const trimmed = doc.trim();
		if (trimmed.length === 0) continue;
		const parsed = unsafeCoerce<{ kind?: string; metadata?: { name?: string } } | null>(
			parseYaml(trimmed),
			"parsed YAML — runtime typeof check below filters to the kind/metadata.name shape",
		);
		if (parsed === null || typeof parsed !== "object") continue;
		const kind = parsed.kind;
		const name = parsed.metadata?.name;
		if (typeof kind !== "string" || typeof name !== "string") continue;
		files.push({
			path: pathSep(dir, Yaml.filenameFor({ kind, metadata: { name } })),
			content: Yaml.serialize({ value: parsed }),
		});
	}
	return files;
};

interface _CollectOutputsInput {
	readonly value: unknown;
	readonly appDir: string;
	readonly pathJoin: (...parts: string[]) => string;
}
const _collectOutputs = (input: _CollectOutputsInput): OutputFile[] => {
	const { value, appDir, pathJoin } = input;
	if (value === null || value === undefined) return [];

	if (
		typeof value === "object" &&
		value !== null &&
		unsafeCoerce<{ _tag?: unknown }>(value, "narrowed to object above; reading optional _tag")._tag === "RawYaml"
	) {
		const raw = unsafeCoerce<{ content: string }>(value, "RawYaml _tag implies the content field");
		return _splitRawYaml({ content: raw.content, dir: appDir, pathSep: pathJoin });
	}

	if (Array.isArray(value)) {
		return value.flatMap((v) => _collectOutputs({ value: v, appDir, pathJoin }));
	}

	if (typeof value === "object") {
		const obj = unsafeCoerce<{ kind?: unknown; metadata?: { name?: unknown } }>(value, "narrowed to object above; probing kind/metadata.name");
		if (typeof obj.kind === "string" && typeof obj.metadata?.name === "string") {
			return [
				{
					path: pathJoin(
						appDir,
						Yaml.filenameFor({ kind: obj.kind, metadata: { name: obj.metadata.name } }),
					),
					content: Yaml.serialize({ value: obj }),
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

export interface RenderEnvInput {
	readonly cfg: ResolvedKonfigConfig;
	readonly envName: string;
	readonly ctx: RenderContext;
}
export const renderEnv = (input: RenderEnvInput) =>
	Effect.gen(function* () {
		const { cfg, envName, ctx } = input;
		const path = yield* Path;
		const entry = yield* _resolveEnvEntry({ cfg, envName });
		const result = yield* _loadEnv(entry);

		const outDirAbs = path.join(
			cfg.configDir,
			cfg.config.root,
			cfg.config.outDir.manifests,
			envName,
			...(ctx.cluster !== undefined ? [ctx.cluster] : []),
		);
		const appsDirAbs = path.join(outDirAbs, result.name);
		type AnyManifest = M.Manifest<unknown>;

		// Normalise both AppOfAppsResult (argo) and BundleSetResult (k8s)
		// into a single `children` list. The `argo` field carries the
		// `Application` reference only when we're in the argo branch — it
		// gates the per-child `Application-<name>.yaml` sentinel emission.
		const isArgo = _isAppOfApps(result);
		const children = isArgo
			? result.apps.map((app) => ({
					name: app.name,
					manifests: app.manifests,
					argo: app,
				}))
			: result.bundles.map((b) => ({
					name: b.name,
					manifests: b.manifests,
					argo: undefined,
				}));

		// Render every child's manifests in parallel — for argo children that's
		// Application's helm/sops fan-out; for bundles it's just the manifest
		// renderers. Bounded at 4 to keep the helm/sops subprocess count
		// manageable.
		const perAppFiles = yield* Effect.all(
			children.map((child) =>
				Effect.gen(function* () {
					const appDir = path.join(outDirAbs, child.name);
					const rendered = yield* Effect.all(
						child.manifests.map((m) =>
							render({
								manifest: unsafeCoerce<AnyManifest>(
									m,
									"child.manifests holds Manifest<unknown> by Bundle/Application contract",
								),
								ctx,
							}),
						),
						{ concurrency: "unbounded" },
					);
					const out: OutputFile[] = [];
					for (const value of rendered) {
						out.push(..._collectOutputs({ value, appDir, pathJoin: path.join }));
					}
					if (isArgo && child.argo !== undefined) {
						out.push({
							path: path.join(appsDirAbs, applicationCRFilename(child.argo)),
							content: serializeApplicationCR({
								app: child.argo,
								target: result.target,
								defaults: result.defaults,
							}),
						});
					}
					return out;
				}),
			),
			{ concurrency: 4 },
		);
		const files: OutputFile[] = perAppFiles.flat();

		return unsafeCoerce<RenderedEnv>({ appsDirAbs, outDirAbs, files }, "shape matches RenderedEnv exactly; mutable file[] widened to readonly");
	}).pipe(Effect.scoped);

export class WriteEnvError extends Data.TaggedError("WriteEnvError")<{
	readonly path: string;
	readonly cause: unknown;
}> {}

/**
 * Atomic write strategy:
 *   1. Wipe any leftover `<outDir>.tmp` from a prior interrupted run.
 *   2. Stage every file under `<outDir>.tmp` (rewriting each file's
 *      destination path to point inside the staging directory).
 *   3. Remove the live `<outDir>` if it exists, then rename
 *      `<outDir>.tmp` → `<outDir>`.
 *
 * Killing the process during step 2 leaves the live `<outDir>` unchanged.
 * Killing during step 3 leaves either the new tree at `<outDir>` (if the
 * rename completed) or the old tree at `<outDir>` plus the new one at
 * `<outDir>.tmp` (recovery: delete one, rename the other) — never a
 * half-rewritten live tree.
 */
export const writeFiles = (
	rendered: RenderedEnv,
): Effect.Effect<ReadonlyArray<string>, WriteEnvError, FileSystem | Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const path = yield* Path;

		const stagingDir = `${rendered.outDirAbs}.tmp`;

		const stagingExists = yield* fs.exists(stagingDir).pipe(Effect.orElseSucceed(() => false));
		if (stagingExists) {
			yield* fs
				.remove(stagingDir, { recursive: true })
				.pipe(Effect.mapError((cause) => new WriteEnvError({ path: stagingDir, cause })));
		}

		const written: string[] = [];
		for (const file of rendered.files) {
			const rel = path.relative(rendered.outDirAbs, file.path);
			const stagedPath = path.join(stagingDir, rel);
			yield* fs
				.makeDirectory(path.dirname(stagedPath), { recursive: true })
				.pipe(Effect.mapError((cause) => new WriteEnvError({ path: stagedPath, cause })));
			yield* fs
				.writeFileString(stagedPath, file.content)
				.pipe(Effect.mapError((cause) => new WriteEnvError({ path: stagedPath, cause })));
			written.push(file.path);
		}

		const liveExists = yield* fs.exists(rendered.outDirAbs).pipe(Effect.orElseSucceed(() => false));
		if (liveExists) {
			yield* fs
				.remove(rendered.outDirAbs, { recursive: true })
				.pipe(Effect.mapError((cause) => new WriteEnvError({ path: rendered.outDirAbs, cause })));
		}
		yield* fs
			.makeDirectory(path.dirname(rendered.outDirAbs), { recursive: true })
			.pipe(
				Effect.mapError(
					(cause) => new WriteEnvError({ path: rendered.outDirAbs, cause }),
				),
			);
		yield* fs
			.rename(stagingDir, rendered.outDirAbs)
			.pipe(Effect.mapError((cause) => new WriteEnvError({ path: rendered.outDirAbs, cause })));
		return written;
	});
