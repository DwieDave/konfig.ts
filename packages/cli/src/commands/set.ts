// M12 — `konfig set <env> <app> <image>`
//
// Reads `<root>/images.json`, mutates a single image tag, writes it
// back through the same Schema gate used by env files at module-load
// time. CI bumps tags this way instead of touching TS source — no AST
// mutator needed, and the post-write decode catches anything that
// would break `konfig validate`.

import { decodeImagesSync, ImagesConfig } from "@konfig.ts/core";
import { Data, Effect, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { Argument, Command } from "effect/unstable/cli";
import { resolveConfig } from "../configResolver";

export class SetUnknownEnv extends Data.TaggedError("SetUnknownEnv")<{
	readonly env: string;
	readonly known: ReadonlyArray<string>;
}> {}

export class ImagesFileError extends Data.TaggedError("ImagesFileError")<{
	readonly path: string;
	readonly cause: unknown;
}> {}

export const setCommand = Command.make(
	"set",
	{
		env: Argument.string("env").pipe(
			Argument.withDescription("Env key in images.json (e.g. prod, staging)"),
		),
		app: Argument.string("app").pipe(
			Argument.withDescription("App key under envs.<env> in images.json"),
		),
		image: Argument.string("image").pipe(
			Argument.withDescription("Full image ref (e.g. ghcr.io/<org>/<app>:<sha>)"),
		),
	},
	(args) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const path = yield* Path;
			const cfg = yield* resolveConfig();

			const file = path.join(cfg.configDir, cfg.config.root, "images.json");
			const text = yield* fs
				.readFileString(file)
				.pipe(Effect.mapError((cause) => new ImagesFileError({ path: file, cause })));

			const parsed = yield* Effect.try({
				try: () => JSON.parse(text) as unknown,
				catch: (cause) => new ImagesFileError({ path: file, cause }),
			});

			// Schema-decode before mutation so we fail early on a malformed
			// file rather than corrupting it further.
			const current = decodeImagesSync(parsed);

			if (!(args.env in current.envs)) {
				const known = Object.keys(current.envs);
				yield* Effect.logError(`unknown env '${args.env}'. Known: ${known.join(", ")}`);
				return yield* Effect.fail(new SetUnknownEnv({ env: args.env, known }));
			}

			const next: ImagesConfig = {
				envs: {
					...current.envs,
					[args.env]: { ...current.envs[args.env], [args.app]: args.image },
				},
			};

			// Re-decode the mutated object as a post-write sanity check.
			// Catches a hypothetical Schema-evolution slip where the in-memory
			// shape diverges from `decodeImagesSync`.
			const decoded = yield* Effect.try({
				try: () => Schema.decodeUnknownSync(ImagesConfig)(next, { onExcessProperty: "error" }),
				catch: (cause) => new ImagesFileError({ path: file, cause }),
			});

			// 1 tab indent + trailing newline mirrors the in-tree style.
			const out = `${JSON.stringify(decoded, null, "\t")}\n`;
			yield* fs
				.writeFileString(file, out)
				.pipe(Effect.mapError((cause) => new ImagesFileError({ path: file, cause })));

			yield* Effect.log(`set ${args.env}.${args.app} = ${args.image}`);
		}),
).pipe(
	Command.withDescription("Update an image tag in images.json (Schema-validated read + write)"),
);
