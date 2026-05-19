
import { exec as execCb } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { resolveCliPaths } from "../cliConfig";
import { assertHelmVersion } from "../helmVersion";

const exec = promisify(execCb);

const _loadChartRegistry = async (
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
		}
	}
	return entries;
};

const _fetchOne = async (opts: {
	repo: string;
	chart: string;
	version: string;
	cacheDir: string;
}): Promise<void> => {
	await fs.mkdir(opts.cacheDir, { recursive: true });
	const cachedTgz = path.join(opts.cacheDir, `${opts.chart}-${opts.version}.tgz`);
	const exists = await fs
		.access(cachedTgz)
		.then(() => true)
		.catch(() => false);
	if (exists) return;

	await exec(
		[
			"helm",
			"pull",
			"--repo",
			opts.repo,
			opts.chart,
			"--version",
			opts.version,
			"--destination",
			opts.cacheDir,
		].join(" "),
	);
};

export const helmFetchCommand = Command.make(
	"fetch",
	{
		all: Flag.boolean("all").pipe(
			Flag.withDescription("Fetch all charts into the local cache"),
			Flag.withDefault(false),
		),
	},
	(flags) =>
		Effect.gen(function* () {
			const { cacheDir, chartsDir, minVersion } = yield* resolveCliPaths;

			yield* assertHelmVersion(minVersion);

			if (!flags.all) {
				yield* Console.error("Specify --all to fetch all charts");
				yield* Effect.fail(new Error("Missing --all flag"));
				return;
			}

			const registry = yield* Effect.tryPromise({
				try: () => _loadChartRegistry(chartsDir),
				catch: (cause) => new Error(`Failed to load chart registry: ${cause}`),
			});

			for (const def of registry) {
				yield* Console.log(`Fetching ${def.chart}@${def.version}...`);
				yield* Effect.tryPromise({
					try: () => _fetchOne({ repo: def.repo, chart: def.chart, version: def.version, cacheDir }),
					catch: (cause) => new Error(`helm pull failed for ${def.chart}: ${cause}`),
				});
			}

			yield* Console.log(`Done. Cache at ${cacheDir}`);
		}),
).pipe(Command.withDescription("Pre-fetch Helm chart tarballs into the local cache"));

export const helmCommand = Command.make("helm", {}, () =>
	Console.log("Run helm --help for available subcommands"),
).pipe(
	Command.withSubcommands([helmFetchCommand]),
	Command.withDescription("Helm chart management commands"),
);
