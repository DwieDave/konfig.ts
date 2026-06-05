import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "../_unstable";
import { renderEnv } from "../buildEnv";
import { resolveConfig } from "../configResolver";
import { renderContextFlags, renderContextFromFlags } from "../renderContextFlags";
import { runKubeconform, validateManifestFile } from "../validator";

export const validateCommand = Command.make(
	"validate",
	{
		env: Argument.string("env").pipe(Argument.withDescription("Env name to validate")),
		strict: Flag.boolean("strict").pipe(
			Flag.withDescription(
				"Additionally run kubeconform -strict over the rendered manifests (requires kubeconform on PATH)",
			),
			Flag.withDefault(false),
		),
		ignoreMissingSchemas: Flag.boolean("ignore-missing-schemas").pipe(
			Flag.withDescription(
				"Pass --ignore-missing-schemas to kubeconform (useful for CRDs the bundled schema set doesn't know)",
			),
			Flag.withDefault(false),
		),
		...renderContextFlags,
	},
	(args) =>
		Effect.gen(function* () {
			const cfg = yield* resolveConfig();
			const ctx = renderContextFromFlags({ env: args.env, flags: args });
			const rendered = yield* renderEnv({ cfg, envName: args.env, ctx });

			const allIssues = yield* Effect.all(
				rendered.files.map((f) => validateManifestFile({ file: f.path, content: f.content })),
				{ concurrency: "unbounded" },
			);
			const issues = allIssues.flat();
			if (issues.length > 0) {
				for (const issue of issues) {
					yield* Console.error(
						`${issue.file} (doc ${issue.doc}) ${issue.path.join(".")}: ${issue.message}`,
					);
				}
				return yield* Effect.fail(
					new Error(`validate: ${issues.length} structural issue(s) in env '${args.env}'`),
				);
			}

			yield* Console.log(
				`OK — env '${args.env}': ${rendered.files.length} file(s) pass structural validation`,
			);

			if (args.strict) {
				yield* Console.log(`Running kubeconform -strict against ${rendered.outDirAbs}...`);
				const extraArgs = args.ignoreMissingSchemas ? (["-ignore-missing-schemas"] as const) : [];
				yield* runKubeconform({ dir: rendered.outDirAbs, extraArgs });
				yield* Console.log(`kubeconform: OK`);
			}
		}),
).pipe(
	Command.withDescription(
		"Render + structural validation. --strict additionally invokes kubeconform.",
	),
);
