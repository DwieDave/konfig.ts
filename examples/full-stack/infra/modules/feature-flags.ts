import { Application } from "@konfig.ts/argocd";
import { ConfigMap } from "@konfig.ts/k8s";
import { Effect } from "effect";

export interface FeatureFlagsOptions {
	readonly source: Application.ArgoSource;
}

/**
 * `app/feature-flags` ConfigMap.
 *
 * Demonstrates `ConfigMapRef<N, K>` key narrowing (round-2 prototype 6):
 * `ConfigMap.make({ data })` infers the literal key union ("NEW_UI",
 * "BETA_DASHBOARD", "DARK_MODE") from the `data` record, and
 * `configMapEnv({ ref: featureFlags.ref, key })` in `api.ts` constrains
 * `key` to that union. Renaming a key here makes every consumer fail
 * type-check at the call site — no silent runtime "env unset" surprise.
 *
 * The exported handle is re-imported by `api.ts` so it can read
 * `featureFlags.ref` and consume specific keys via `configMapEnv`.
 */
export const featureFlags = ConfigMap.make({
	name: "feature-flags",
	namespace: "app",
	data: {
		NEW_UI: "true",
		BETA_DASHBOARD: "false",
		DARK_MODE: "true",
	},
});

export const defineFeatureFlags = (opts: FeatureFlagsOptions) =>
	Application.define({
		name: "feature-flags",
		namespace: "app",
		source: opts.source,
		annotations: { "argocd.argoproj.io/sync-wave": "-1" },
		build: Effect.succeed([featureFlags]),
	});
