
import {
	type DiffFormat,
	diffFiles,
	formatDiff,
	hasDifferences,
	unsafeCoerce,
} from "@konfig.ts/core";
import { Console, Data, Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { Argument, Command, Flag } from "../_unstable";
import { renderEnv } from "../buildEnv";
import { resolveConfig } from "../configResolver";
import { renderContextFlags, renderContextFromFlags } from "../renderContextFlags";

class DiffBaselineMissing extends Data.TaggedError("DiffBaselineMissing")<{
	readonly env: string;
}> {}

const _readBaseline = (baselineDir: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const path = yield* Path;

		const collect = (
			dir: string,
		): Effect.Effect<Record<string, string>, never, FileSystem | Path> =>
			Effect.gen(function* () {
				const entries = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => []));
				const out: Record<string, string> = {};
				for (const e of entries) {
					const full = path.join(dir, e);
					const stat = yield* fs.stat(full).pipe(Effect.orElseSucceed(() => null));
					if (stat?.type === "Directory") {
						const sub = yield* collect(full);
						for (const [k, v] of Object.entries(sub)) {
							out[`${e}/${k}`] = v;
						}
					} else if (stat?.type === "File" && e.endsWith(".yaml")) {
						const content = yield* fs.readFileString(full).pipe(Effect.orElseSucceed(() => ""));
						out[e] = content;
					}
				}
				return out;
			});
		return yield* collect(baselineDir);
	});

export const diffCommand = Command.make(
	"diff",
	{
		env: Argument.string("env").pipe(Argument.withDescription("Env to diff")),
		format: Flag.choice("format", ["summary", "detail", "json"] as const).pipe(
			Flag.withDescription("Output format"),
			Flag.withDefault("summary" as const),
		),
		...renderContextFlags,
	},
	(args) =>
		Effect.gen(function* () {
			const cfg = yield* resolveConfig();
			const ctx = renderContextFromFlags({ env: args.env, flags: args });
			const path = yield* Path;

			if (cfg.config.diff === undefined) {
				return yield* Effect.fail(new DiffBaselineMissing({ env: args.env }));
			}

			const rendered = yield* renderEnv({ cfg, envName: args.env, ctx });

			// Left: nixidy baseline, right: tsk render. Keys are filenames
			// relative to each env root.
			const baselineDirAbs = path.join(
				cfg.configDir,
				cfg.config.root,
				cfg.config.diff.baseline,
				args.env,
			);
			const left = yield* _readBaseline(baselineDirAbs);

			const right: Record<string, string> = {};
			for (const file of rendered.files) {
				const rel = path.relative(rendered.outDirAbs, file.path);
				right[rel] = file.content;
			}

			const result = diffFiles({ left, right });
			if (hasDifferences(result)) {
				yield* Console.log(formatDiff({ result, format: unsafeCoerce<DiffFormat>(args.format, "Flag.choice narrows args.format to the same union as DiffFormat") }));
				return yield* Effect.fail(new Error(`Diff non-empty for env '${args.env}'`));
			}
			yield* Console.log(`OK — env '${args.env}' matches baseline`);
		}),
).pipe(Command.withDescription("Structural diff vs the nixidy baseline"));
