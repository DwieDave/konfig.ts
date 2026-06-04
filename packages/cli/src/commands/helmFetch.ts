import { Console, Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { ChildProcess, ChildProcessSpawner, Command, Flag } from "../_unstable";
import { loadChartRegistry } from "../chartRegistry";
import { resolveCliPaths } from "../cliConfig";
import { assertHelmVersion } from "../helmVersion";

interface FetchOneInput {
	readonly repo: string;
	readonly chart: string;
	readonly version: string;
	readonly cacheDir: string;
}

const _fetchOne = (input: FetchOneInput) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const path = yield* Path;
		const spawner = yield* ChildProcessSpawner;

		yield* fs.makeDirectory(input.cacheDir, { recursive: true });
		const cachedTgz = path.join(input.cacheDir, `${input.chart}-${input.version}.tgz`);
		const exists = yield* fs.exists(cachedTgz);
		if (exists) return;

		const cmd = ChildProcess.make("helm", [
			"pull",
			"--repo",
			input.repo,
			input.chart,
			"--version",
			input.version,
			"--destination",
			input.cacheDir,
		]);
		yield* spawner.exitCode(cmd);
	});

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
				try: () => loadChartRegistry(chartsDir),
				catch: (cause) => new Error(`Failed to load chart registry: ${cause}`),
			});

			for (const def of registry) {
				yield* Console.log(`Fetching ${def.chart}@${def.version}...`);
				yield* _fetchOne({
					repo: def.repo,
					chart: def.chart,
					version: def.version,
					cacheDir,
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
