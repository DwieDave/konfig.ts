import { HelmVersionTooLow, runProcessString } from "@konfig.ts/core";
import { Effect } from "effect";
import { ChildProcess } from "./_unstable";
import semver from "semver";

/**
 * Parse a semver string out of `helm version --short` output. Full
 * semver including pre-release / build metadata is preserved so that
 * `v3.16.0-rc.1` reports as `3.16.0-rc.1` (not silently truncated to
 * `3.16.0` and then misjudged as < 3.16.0 by `semver.gte`).
 */
export const _parseHelmVersion = (output: string): string | null => {
	const match = /v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)/.exec(output.trim());
	return match?.[1] ?? null;
};

export const assertHelmVersion = (minVersion: string) =>
	Effect.gen(function* () {
		const cmd = ChildProcess.make("helm", ["version", "--short"]);
		const stdout = yield* runProcessString(cmd, { allowEmptyStdout: false }).pipe(
			Effect.mapError(() => new HelmVersionTooLow({ required: minVersion, found: "not found" })),
		);

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
