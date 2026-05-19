
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { HelmVersionTooLow } from "@konfig.ts/core";
import { Effect } from "effect";
import semver from "semver";

const exec = promisify(execCb);

const _parseHelmVersion = (output: string): string | null => {
	const match = /v?(\d+\.\d+\.\d+)/.exec(output.trim());
	return match?.[1] ?? null;
};

export const assertHelmVersion = (minVersion: string): Effect.Effect<void, HelmVersionTooLow> =>
	Effect.tryPromise({
		try: () => exec("helm version --short"),
		catch: () => new HelmVersionTooLow({ required: minVersion, found: "not found" }),
	}).pipe(
		Effect.flatMap(({ stdout }) => {
			const found = _parseHelmVersion(stdout);
			if (!found) {
				return Effect.fail(new HelmVersionTooLow({ required: minVersion, found: stdout.trim() }));
			}
			if (!semver.gte(found, minVersion)) {
				return Effect.fail(new HelmVersionTooLow({ required: minVersion, found }));
			}
			return Effect.void;
		}),
	);
