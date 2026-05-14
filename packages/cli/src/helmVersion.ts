// T6.2 — Helm CLI startup assertion.
// Run `helm version --short`, parse the version string, and fail fast with a
// structured error if the installed helm is older than the configured minimum.

import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { HelmVersionTooLow } from "@konfig.ts/core";
import { Effect } from "effect";
import semver from "semver";

const exec = promisify(execCb);

// Parse `helm version --short` output.
// v3.16.0+g1a6a4bb → "3.16.0"
// v3.16.0          → "3.16.0"
const parseHelmVersion = (output: string): string | null => {
	const match = /v?(\d+\.\d+\.\d+)/.exec(output.trim());
	return match?.[1] ?? null;
};

/**
 * Assert that the `helm` CLI on PATH meets the minimum version requirement.
 * Called at startup by any command that invokes helm (`crd extract`,
 * `crd verify`, `helm fetch`). Safe to skip for `validate`, `set`, `services`,
 * `graph` (per FR-7.6).
 */
export const assertHelmVersion = (minVersion: string): Effect.Effect<void, HelmVersionTooLow> =>
	Effect.tryPromise({
		try: () => exec("helm version --short"),
		catch: () => new HelmVersionTooLow({ required: minVersion, found: "not found" }),
	}).pipe(
		Effect.flatMap(({ stdout }) => {
			const found = parseHelmVersion(stdout);
			if (!found) {
				return Effect.fail(new HelmVersionTooLow({ required: minVersion, found: stdout.trim() }));
			}
			if (!semver.gte(found, minVersion)) {
				return Effect.fail(new HelmVersionTooLow({ required: minVersion, found }));
			}
			return Effect.void;
		}),
	);
