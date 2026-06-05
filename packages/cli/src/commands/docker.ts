import {
	deepEqual,
	type DiffFormat,
	diffFiles,
	formatDiff,
	hasDifferences,
	parseYaml,
	redact,
	unsafeCoerce,
} from "@konfig.ts/core";
import {
	DockerWriteError,
	DockerWriteRefused,
	emit,
	extractHeader,
	findRoot,
	HEADER_MARKER,
	isDockerApp,
} from "@konfig.ts/docker";
import { Console, Data, Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { Argument, Command, Flag } from "../_unstable";

void deepEqual;
void parseYaml;
void redact;

class SpecImportError extends Data.TaggedError("SpecImportError")<{
	readonly specPath: string;
	readonly cause: unknown;
}> {}

class SpecNotADockerApp extends Data.TaggedError("SpecNotADockerApp")<{
	readonly specPath: string;
}> {}

class DiffDrift extends Data.TaggedError("DiffDrift")<{
	readonly target: string;
	readonly kind: "prod" | "dev";
}> {}

interface SpecLoad {
	readonly app: import("@konfig.ts/docker").DockerApp;
	readonly targetAbs: string;
	readonly specPath: string;
	readonly root: string;
}

const _loadSpec = (
	targetArg: string,
): Effect.Effect<SpecLoad, SpecImportError | SpecNotADockerApp | import("@konfig.ts/docker").AnyDockerError, FileSystem | Path> =>
	Effect.gen(function* () {
		const p = yield* Path;
		const targetAbs = p.resolve(process.cwd(), targetArg);
		const dockerTsPath = p.join(targetAbs, "docker.ts");
		const mod = yield* Effect.tryPromise({
			try: () => import(dockerTsPath),
			catch: (e) => new SpecImportError({ specPath: dockerTsPath, cause: e }),
		});
		const app = unsafeCoerce<{ readonly default: unknown }>(
			mod,
			"dynamic import() returns a module namespace object; .default is typed unknown and guarded by isDockerApp below",
		).default;
		if (!isDockerApp(app)) {
			return yield* Effect.fail(new SpecNotADockerApp({ specPath: dockerTsPath }));
		}
		const root = yield* findRoot(targetAbs);
		const specPath = p.relative(root, dockerTsPath);
		return { app, targetAbs, specPath, root };
	});

const _emitFor = (load: SpecLoad) =>
	emit({ spec: { ...load.app.spec, target: load.targetAbs }, specPath: load.specPath });

const _writeAtomic = (
	fs: FileSystem,
	p: Path,
	path: string,
	content: string,
): Effect.Effect<void, DockerWriteError> =>
	Effect.gen(function* () {
		const tmp = `${path}.tmp.${process.pid}`;
		yield* fs.writeFileString(tmp, content).pipe(
			Effect.mapError((cause) => new DockerWriteError({ path, cause })),
		);
		yield* fs.rename(tmp, path).pipe(
			Effect.mapError((cause) => new DockerWriteError({ path, cause })),
		);
		void p;
	});

const _writeOne = (
	dest: string,
	content: string,
	force: boolean,
): Effect.Effect<{ written: boolean }, DockerWriteRefused | DockerWriteError, FileSystem | Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const p = yield* Path;
		const existed = yield* fs.exists(dest).pipe(Effect.orElseSucceed(() => false));
		if (existed) {
			const existing = yield* fs.readFileString(dest).pipe(Effect.orElseSucceed(() => ""));
			const head = extractHeader(existing);
			if (!head.managed && !force) {
				return yield* Effect.fail(
					new DockerWriteRefused({
						path: dest,
						reason: `destination is not konfig-managed (missing marker "${HEADER_MARKER}"). Use --force to overwrite.`,
					}),
				);
			}
			if (head.managed && existing === content) return { written: false };
		}
		yield* _writeAtomic(fs, p, dest, content);
		return { written: true };
	});

export const previewCommand = Command.make(
	"preview",
	{
		target: Argument.string("target").pipe(Argument.withDescription("workspace dir relative to cwd")),
		prodOnly: Flag.boolean("prod-only").pipe(Flag.withDescription("only emit the prod Dockerfile"), Flag.withDefault(false)),
		devOnly: Flag.boolean("dev-only").pipe(Flag.withDescription("only emit the dev Dockerfile"), Flag.withDefault(false)),
	},
	(args) =>
		Effect.gen(function* () {
			const load = yield* _loadSpec(args.target);
			const e = yield* _emitFor(load);
			if (!args.devOnly) yield* Console.log(e.dockerfile);
			if (!args.prodOnly && e.dockerfileDev) {
				if (!args.devOnly) yield* Console.log("\n# ---- Dockerfile.dev ----\n");
				yield* Console.log(e.dockerfileDev);
			}
		}),
).pipe(Command.withDescription("Render Dockerfile(s) for a target to stdout"));

export const writeCommand = Command.make(
	"write",
	{
		target: Argument.string("target").pipe(Argument.withDescription("workspace dir relative to cwd")),
		outDir: Flag.string("out-dir").pipe(
			Flag.withDescription("destination directory (default: <target>)"),
			Flag.optional,
		),
		prodOnly: Flag.boolean("prod-only").pipe(Flag.withDefault(false)),
		devOnly: Flag.boolean("dev-only").pipe(Flag.withDefault(false)),
		force: Flag.boolean("force").pipe(
			Flag.withDescription("overwrite a destination file even if it is not konfig-managed"),
			Flag.withDefault(false),
		),
	},
	(args) =>
		Effect.gen(function* () {
			const p = yield* Path;
			const load = yield* _loadSpec(args.target);
			const e = yield* _emitFor(load);
			const outDirAbs = args.outDir._tag === "Some"
				? p.resolve(process.cwd(), args.outDir.value)
				: load.targetAbs;
			if (!args.devOnly) {
				const dest = p.join(outDirAbs, "Dockerfile");
				const r = yield* _writeOne(dest, e.dockerfile, args.force);
				yield* Console.log(r.written ? `wrote ${dest}` : `unchanged ${dest}`);
			}
			if (!args.prodOnly && e.dockerfileDev) {
				const dest = p.join(outDirAbs, "Dockerfile.dev");
				const r = yield* _writeOne(dest, e.dockerfileDev, args.force);
				yield* Console.log(r.written ? `wrote ${dest}` : `unchanged ${dest}`);
			}
		}),
).pipe(Command.withDescription("Write Dockerfile + Dockerfile.dev next to a target"));

const _diffOne = (
	dest: string,
	emitted: string,
	kind: "prod" | "dev",
	target: string,
	format: DiffFormat,
): Effect.Effect<boolean, DiffDrift, FileSystem | Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const onDisk = yield* fs.readFileString(dest).pipe(Effect.orElseSucceed(() => ""));
		const head = extractHeader(onDisk);
		const emittedHead = extractHeader(emitted);
		if (head.managed && emittedHead.managed && head.hash === emittedHead.hash) return true;
		const result = diffFiles({
			left: { [dest]: onDisk },
			right: { [dest]: emitted },
		});
		if (!hasDifferences(result)) return true;
		yield* Console.log(formatDiff({ result, format }));
		return yield* Effect.fail(new DiffDrift({ target, kind }));
	});

export const diffCommand = Command.make(
	"diff",
	{
		target: Argument.string("target").pipe(Argument.withDescription("workspace dir relative to cwd")),
		format: Flag.choice("format", ["summary", "detail", "json"] as const).pipe(
			Flag.withDescription("Output format"),
			Flag.withDefault("summary" as const),
		),
	},
	(args) =>
		Effect.gen(function* () {
			const p = yield* Path;
			const load = yield* _loadSpec(args.target);
			const e = yield* _emitFor(load);
			const fmt = unsafeCoerce<DiffFormat>(
				args.format,
				"args.format is constrained by the Flag schema to DiffFormat; the union is widened by Effect's CLI types",
			);
			yield* _diffOne(p.join(load.targetAbs, "Dockerfile"), e.dockerfile, "prod", args.target, fmt);
			if (e.dockerfileDev) {
				yield* _diffOne(
					p.join(load.targetAbs, "Dockerfile.dev"),
					e.dockerfileDev,
					"dev",
					args.target,
					fmt,
				);
			}
			yield* Console.log(`OK — ${args.target} matches`);
		}),
).pipe(Command.withDescription("Diff would-emit Dockerfiles vs on-disk; non-zero exit on drift"));

export const dockerCommand = Command.make("docker").pipe(
	Command.withDescription("Generate Dockerfile + Dockerfile.dev from a target's docker.ts spec"),
	Command.withSubcommands([previewCommand, writeCommand, diffCommand]),
);
