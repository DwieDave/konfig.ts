import { Console, Effect } from "effect";
import { Argument, Command } from "../_unstable";
import { renderEnv } from "../buildEnv";
import { resolveConfig } from "../configResolver";
import { renderContextFlags, renderContextFromFlags } from "../renderContextFlags";

export const validateCommand = Command.make(
	"validate",
	{
		env: Argument.string("env").pipe(Argument.withDescription("Env name to validate")),
		...renderContextFlags,
	},
	(args) =>
		Effect.gen(function* () {
			const cfg = yield* resolveConfig();
			const ctx = renderContextFromFlags(args.env, args);
			const rendered = yield* renderEnv({ cfg, envName: args.env, ctx });
			yield* Console.log(
				`OK — env '${args.env}': ${rendered.files.length} file(s) would be written`,
			);
		}),
).pipe(Command.withDescription("Schema-decode + dep-graph check, no I/O"));
