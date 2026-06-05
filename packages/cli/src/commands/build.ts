import { Console, Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Argument, Command, Flag } from "../_unstable";
import {
	computeInputHash,
	computeOutputHash,
	readCacheEntry,
	writeCacheEntry,
} from "../buildCache";
import { renderEnv, writeFiles } from "../buildEnv";
import { resolveConfig } from "../configResolver";
import { renderContextFlags, renderContextFromFlags } from "../renderContextFlags";

const _formatReport = (
	envName: string,
	timing: {
		renderMs: number;
		writeMs: number;
		files: number;
		outDir: string;
		cached?: boolean;
	},
	logFmt: "text" | "json",
): string => {
	if (logFmt === "json") {
		return JSON.stringify({
			env: envName,
			files: timing.files,
			outDir: timing.outDir,
			renderMs: timing.renderMs,
			writeMs: timing.writeMs,
			totalMs: timing.renderMs + timing.writeMs,
			cached: timing.cached ?? false,
		});
	}
	if (timing.cached) {
		return `Cached — env '${envName}' inputs unchanged, ${timing.files} file(s) at ${timing.outDir}`;
	}
	return `Wrote ${timing.files} file(s) to ${timing.outDir} — render ${timing.renderMs}ms, write ${timing.writeMs}ms`;
};

export const buildCommand = Command.make(
	"build",
	{
		env: Argument.string("env").pipe(Argument.withDescription("Env name to build (e.g. prod)")),
		log: Flag.choice("log", ["text", "json"] as const).pipe(
			Flag.withDescription("Output format for log lines"),
			Flag.withDefault("text" as const),
		),
		verbose: Flag.boolean("verbose").pipe(
			Flag.withDescription("Enable Effect tracing for the render program"),
			Flag.withDefault(false),
		),
		noCache: Flag.boolean("no-cache").pipe(
			Flag.withDescription(
				"Skip the input-hash check and force a fresh render (debug / first-build use).",
			),
			Flag.withDefault(false),
		),
		...renderContextFlags,
	},
	(args) =>
		Effect.gen(function* () {
			const cfg = yield* resolveConfig();
			const ctx = renderContextFromFlags({ env: args.env, flags: args });
			const fs = yield* FileSystem;
			const logFmt = args.log;

			let cachedInputHash: string | undefined;
			if (!args.noCache) {
				const inputHash = yield* computeInputHash({ cfg, envName: args.env });
				cachedInputHash = inputHash;
				const entry = yield* readCacheEntry({ cfg, envName: args.env });
				if (entry !== undefined && entry.inputHash === inputHash) {
					const outDirExists = yield* fs
						.exists(entry.outDirAbs)
						.pipe(Effect.orElseSucceed(() => false));
					if (outDirExists) {
						yield* Console.log(
							_formatReport(
								args.env,
								{
									renderMs: 0,
									writeMs: 0,
									files: entry.fileCount,
									outDir: entry.outDirAbs,
									cached: true,
								},
								logFmt,
							),
						);
						return;
					}
				}
			}

			if (logFmt === "text") {
				yield* Console.log(`Rendering env '${args.env}'...`);
			}

			const renderStart = Date.now();
			const renderProgram = renderEnv({ cfg, envName: args.env, ctx });
			const rendered = yield* (args.verbose
				? renderProgram.pipe(Effect.withSpan(`konfig.render.${args.env}`))
				: renderProgram);
			const renderMs = Date.now() - renderStart;

			const writeStart = Date.now();
			const written = yield* writeFiles(rendered);
			const writeMs = Date.now() - writeStart;

			if (!args.noCache && cachedInputHash !== undefined) {
				const outputHash = computeOutputHash(rendered.files);
				yield* writeCacheEntry({
					cfg,
					envName: args.env,
					entry: {
						inputHash: cachedInputHash,
						outputHash,
						outDirAbs: rendered.outDirAbs,
						fileCount: written.length,
						timestamp: new Date().toISOString(),
					},
				});
			}

			yield* Console.log(
				_formatReport(
					args.env,
					{
						renderMs,
						writeMs,
						files: written.length,
						outDir: rendered.outDirAbs,
					},
					logFmt,
				),
			);
		}),
).pipe(Command.withDescription("Render manifests for an env"));
