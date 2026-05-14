// T4.7 — `konfig build <env>` command.
//
// Resolves konfig.json, evaluates the env's entrypoint, renders every
// Application to per-file YAML, and writes the tree to
// `<configDir>/<root>/<outDir.manifests>/<env>/`.

import { RenderContext } from "@konfig.ts/core";
import { Console, Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";
import { renderEnv, writeFiles } from "../buildEnv";
import { resolveConfig } from "../configResolver";

export const buildCommand = Command.make(
	"build",
	{
		env: Argument.string("env").pipe(Argument.withDescription("Env name to build (e.g. prod)")),
	},
	(args) =>
		Effect.gen(function* () {
			const cfg = yield* resolveConfig();
			const ctx = RenderContext.make(args.env);
			yield* Console.log(`Rendering env '${args.env}'...`);
			const rendered = yield* renderEnv(cfg, args.env, ctx);
			const written = yield* writeFiles(rendered);
			yield* Console.log(`Wrote ${written.length} file(s) to ${rendered.outDirAbs}`);
		}),
).pipe(Command.withDescription("Render manifests for an env"));
