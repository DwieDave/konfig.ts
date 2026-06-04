import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "../_unstable";
import { renderEnv, writeFiles } from "../buildEnv";
import { resolveConfig } from "../configResolver";
import { renderContextFlags, renderContextFromFlags } from "../renderContextFlags";

const _formatReport = (
	envName: string,
	timing: { renderMs: number; writeMs: number; files: number; outDir: string },
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
		});
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
		...renderContextFlags,
	},
	(args) =>
		Effect.gen(function* () {
			const cfg = yield* resolveConfig();
			const ctx = renderContextFromFlags(args.env, args);
			const logFmt = args.log;
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
