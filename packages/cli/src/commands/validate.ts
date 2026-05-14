// T4.8 — `konfig validate <env>` command.
//
// Decodes konfig.json + loads the env entrypoint. No disk I/O for output.
// The AppOfApps type-level check catches missing deps at compile time;
// at runtime we exercise the boundary Schema decode for every module
// (their `boundary(...)` wrappers raise on bad input).

import { RenderContext } from "@konfig.ts/core";
import { Console, Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";
import { renderEnv } from "../buildEnv";
import { resolveConfig } from "../configResolver";

export const validateCommand = Command.make(
	"validate",
	{
		env: Argument.string("env").pipe(Argument.withDescription("Env name to validate")),
	},
	(args) =>
		Effect.gen(function* () {
			const cfg = yield* resolveConfig();
			const ctx = RenderContext.make(args.env);
			// `renderEnv` invokes every module's boundary decode and every
			// Manifest.render — strictly more rigorous than a static type check.
			// We discard the rendered output; nothing hits disk.
			const rendered = yield* renderEnv(cfg, args.env, ctx);
			yield* Console.log(
				`OK — env '${args.env}': ${rendered.files.length} file(s) would be written`,
			);
		}),
).pipe(Command.withDescription("Schema-decode + dep-graph check, no I/O"));
