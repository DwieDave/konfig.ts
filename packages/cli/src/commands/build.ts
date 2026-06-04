import { Console, Effect } from "effect";
import { Argument, Command } from "../_unstable";
import { renderEnv, writeFiles } from "../buildEnv";
import { resolveConfig } from "../configResolver";
import { renderContextFlags, renderContextFromFlags } from "../renderContextFlags";

export const buildCommand = Command.make(
	"build",
	{
		env: Argument.string("env").pipe(Argument.withDescription("Env name to build (e.g. prod)")),
		...renderContextFlags,
	},
	(args) =>
		Effect.gen(function* () {
			const cfg = yield* resolveConfig();
			const ctx = renderContextFromFlags(args.env, args);
			yield* Console.log(`Rendering env '${args.env}'...`);
			const rendered = yield* renderEnv({ cfg, envName: args.env, ctx });
			const written = yield* writeFiles(rendered);
			yield* Console.log(`Wrote ${written.length} file(s) to ${rendered.outDirAbs}`);
		}),
).pipe(Command.withDescription("Render manifests for an env"));
