import * as path from "node:path";
import { Console, Effect, Option } from "effect";
import { Command, Flag } from "../_unstable";
import { loadChartRegistry } from "../chartRegistry";
import { resolveCliPaths } from "../cliConfig";
import { extractCrdsEffect, verifyCrdsEffect } from "../crd/extract";
import { assertHelmVersion } from "../helmVersion";

export const crdExtractCommand = Command.make(
	"extract",
	{
		release: Flag.string("release").pipe(Flag.withDescription("Chart release id"), Flag.optional),
		all: Flag.boolean("all").pipe(
			Flag.withDescription("Extract for all charts"),
			Flag.withDefault(false),
		),
	},
	(flags) =>
		Effect.gen(function* () {
			const { cacheDir, outDir, chartsDir, minVersion } = yield* resolveCliPaths;

			yield* assertHelmVersion(minVersion);

			const registry = yield* Effect.tryPromise({
				try: () => loadChartRegistry(chartsDir),
				catch: (cause) => new Error(`Failed to load chart registry: ${cause}`),
			});

			const releaseId = Option.getOrUndefined(flags.release);

			if (releaseId !== undefined) {
				const def = registry.find((r) => r.id === releaseId);
				if (!def) {
					yield* Console.error(
						`Release '${releaseId}' not found in ${chartsDir}. Available: ${registry.map((r) => r.id).join(", ")}`,
					);
					yield* Effect.fail(new Error(`Release not found: ${releaseId}`));
					return;
				}
				yield* Console.log(`Extracting CRDs for ${def.chart}@${def.version}...`);
				yield* extractCrdsEffect({
					repo: def.repo,
					chart: def.chart,
					version: def.version,
					id: def.id,
					outDir,
					cacheDir,
				});
				yield* Console.log(`Written to ${path.join(outDir, `${def.id}.ts`)}`);
			} else if (flags.all) {
				if (registry.length === 0) {
					yield* Console.log(`No chart definitions found in ${chartsDir}`);
					return;
				}
				for (const def of registry) {
					yield* Console.log(`Extracting CRDs for ${def.chart}@${def.version}...`);
					yield* extractCrdsEffect({
						repo: def.repo,
						chart: def.chart,
						version: def.version,
						id: def.id,
						outDir,
						cacheDir,
					});
				}
				yield* Console.log(`Done. Generated files in ${outDir}`);
			} else {
				yield* Console.error("Specify --release <id> or --all");
				yield* Effect.fail(new Error("Missing --release or --all flag"));
			}
		}),
).pipe(Command.withDescription("Extract CRD TypeScript types from Helm charts"));

export const crdVerifyCommand = Command.make("verify", {}, () =>
	Effect.gen(function* () {
		const { cacheDir, outDir, chartsDir, minVersion } = yield* resolveCliPaths;

		yield* assertHelmVersion(minVersion);

		const registry = yield* Effect.tryPromise({
			try: () => loadChartRegistry(chartsDir),
			catch: (cause) => new Error(`Failed to load chart registry: ${cause}`),
		});

		if (registry.length === 0) {
			yield* Console.log("No chart definitions found — nothing to verify");
			return;
		}

		const releases = registry.map((r) => ({
			repo: r.repo,
			chart: r.chart,
			version: r.version,
			id: r.id,
			outDir,
			cacheDir,
		}));

		yield* Console.log(`Verifying ${releases.length} chart(s) against ${outDir}...`);

		const drifted = yield* verifyCrdsEffect({ releases, committedDir: outDir });

		if (drifted.length > 0) {
			yield* Console.error(`CRD drift detected in: ${drifted.join(", ")}`);
			yield* Console.error("Run `konfig crd extract --all` to regenerate");
			yield* Effect.fail(new Error("CRD drift"));
		} else {
			yield* Console.log("OK — all CRD files match");
		}
	}),
).pipe(Command.withDescription("Verify committed CRD types match current charts"));

export const crdCommand = Command.make("crd", {}, () =>
	Console.log("Run crd --help for available subcommands"),
).pipe(
	Command.withSubcommands([crdExtractCommand, crdVerifyCommand]),
	Command.withDescription("CRD codegen commands"),
);
