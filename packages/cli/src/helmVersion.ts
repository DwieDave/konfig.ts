import { HelmVersionTooLow } from "@konfig.ts/core";
import { Effect } from "effect";
import { ChildProcess, ChildProcessSpawner } from "./_unstable";
import semver from "semver";

const _parseHelmVersion = (output: string): string | null => {
	const match = /v?(\d+\.\d+\.\d+)/.exec(output.trim());
	return match?.[1] ?? null;
};

export const assertHelmVersion = (minVersion: string) =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner;
		const cmd = ChildProcess.make("helm", ["version", "--short"]);
		const stdout = yield* spawner
			.string(cmd)
			.pipe(Effect.mapError(() => new HelmVersionTooLow({ required: minVersion, found: "not found" })));

		const found = _parseHelmVersion(stdout);
		if (!found) {
			return yield* Effect.fail(
				new HelmVersionTooLow({ required: minVersion, found: stdout.trim() }),
			);
		}
		if (!semver.gte(found, minVersion)) {
			return yield* Effect.fail(new HelmVersionTooLow({ required: minVersion, found }));
		}
	}).pipe(Effect.scoped);
