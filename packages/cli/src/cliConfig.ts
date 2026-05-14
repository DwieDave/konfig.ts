// Effect `Config` bindings for the env-var overrides the CLI accepts until
// `konfig.json` resolution lands in M4 (T4.2). Each is `Config<string>` with a
// CWD-relative default; consumers yield them inside `Effect.gen` to pick
// values up from the ambient `ConfigProvider` (default reads from `process.env`).

import { Config, Effect } from "effect";
import { Path } from "effect/Path";

export const DEFAULT_MIN_HELM_VERSION = "3.16.0";
export const DEFAULT_CRD_OUT_DIR = ".generated/crd";
export const DEFAULT_HELM_CACHE = ".konfig/helm-cache";
export const DEFAULT_CHARTS_DIR = "infra/k8s-konfig/charts";

// CWD is the only `process` field we still read directly — until `konfig.json`
// resolution arrives (M4 T4.2), the CLI anchors its defaults to the directory
// the user invoked it from. Once M4 lands, this becomes the directory of the
// resolved `konfig.json`.
const cwd = (): string => process.cwd();

// Resolves the four env-var-backed paths. Yielded once per command so a single
// `Path` service lookup serves the whole batch.
export const resolveCliPaths = Effect.gen(function* () {
	const path = yield* Path;

	const cacheDir = yield* Config.string("TSK_HELM_CACHE").pipe(
		Config.withDefault(path.join(cwd(), DEFAULT_HELM_CACHE)),
	);
	const outDir = yield* Config.string("TSK_CRD_OUT_DIR").pipe(
		Config.withDefault(path.join(cwd(), DEFAULT_CRD_OUT_DIR)),
	);
	const chartsDir = yield* Config.string("TSK_CHARTS_DIR").pipe(
		Config.withDefault(path.join(cwd(), DEFAULT_CHARTS_DIR)),
	);
	const minVersion = yield* Config.string("TSK_HELM_MIN_VERSION").pipe(
		Config.withDefault(DEFAULT_MIN_HELM_VERSION),
	);

	return { cacheDir, outDir, chartsDir, minVersion } as const;
});
