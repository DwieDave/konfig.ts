// T6.3 / T6.4 / T6.5 — `konfig crd extract` and `konfig crd verify` commands.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Console, Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { resolveCliPaths } from "../cliConfig";
import { extractCrds, verifyCrds } from "../crd/extract";
import { assertHelmVersion } from "../helmVersion";

// Load chart definitions from a directory. Each *.ts file must export an
// object with `_tskHelmRelease: true` (produced by `defineChart`).
const loadChartRegistry = async (
	chartsDir: string,
): Promise<
	Array<{
		id: string;
		repo: string;
		chart: string;
		version: string;
		digest: string;
	}>
> => {
	const entries: Array<{
		id: string;
		repo: string;
		chart: string;
		version: string;
		digest: string;
	}> = [];

	let files: string[];
	try {
		files = await fs.readdir(chartsDir);
	} catch {
		return entries;
	}

	for (const file of files.filter((f) => f.endsWith(".ts") && !f.startsWith("_"))) {
		try {
			// Dynamic import — works under Bun which runs TS directly.
			const mod = await import(path.resolve(chartsDir, file));
			for (const key of Object.keys(mod)) {
				const val = mod[key];
				if (
					val &&
					typeof val === "object" &&
					"_tskHelmRelease" in val &&
					val._tskHelmRelease === true
				) {
					entries.push({
						id: String(val.id ?? file.replace(/\.ts$/, "")),
						repo: String(val.repo ?? ""),
						chart: String(val.chart ?? ""),
						version: String(val.version ?? ""),
						digest: String(val.digest ?? ""),
					});
					break;
				}
			}
		} catch {
			// Skip files that can't be imported at this stage
		}
	}
	return entries;
};

// `konfig crd extract --release <id>` — T6.3 / `konfig crd extract --all` — T6.4
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
				// Single release — T6.3
				const def = registry.find((r) => r.id === releaseId);
				if (!def) {
					yield* Console.error(
						`Release '${releaseId}' not found in ${chartsDir}. Available: ${registry.map((r) => r.id).join(", ")}`,
					);
					yield* Effect.fail(new Error(`Release not found: ${releaseId}`));
					return;
				}
				yield* Console.log(`Extracting CRDs for ${def.chart}@${def.version}...`);
				yield* Effect.tryPromise({
					try: () =>
						extractCrds({
							repo: def.repo,
							chart: def.chart,
							version: def.version,
							id: def.id,
							outDir,
							cacheDir,
						}),
					catch: (cause) => new Error(`CRD extraction failed: ${cause}`),
				});
				yield* Console.log(`Written to ${path.join(outDir, `${def.id}.ts`)}`);
			} else if (flags.all) {
				// All releases — T6.4
				if (registry.length === 0) {
					yield* Console.log(`No chart definitions found in ${chartsDir}`);
					return;
				}
				for (const def of registry) {
					yield* Console.log(`Extracting CRDs for ${def.chart}@${def.version}...`);
					yield* Effect.tryPromise({
						try: () =>
							extractCrds({
								repo: def.repo,
								chart: def.chart,
								version: def.version,
								id: def.id,
								outDir,
								cacheDir,
							}),
						catch: (cause) => new Error(`CRD extraction failed for ${def.id}: ${cause}`),
					});
				}
				yield* Console.log(`Done. Generated files in ${outDir}`);
			} else {
				yield* Console.error("Specify --release <id> or --all");
				yield* Effect.fail(new Error("Missing --release or --all flag"));
			}
		}),
).pipe(Command.withDescription("Extract CRD TypeScript types from Helm charts"));

// `konfig crd verify` — T6.5
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

		const drifted = yield* Effect.tryPromise({
			try: () => verifyCrds(releases, outDir),
			catch: (cause) => new Error(`Verify failed: ${cause}`),
		});

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
