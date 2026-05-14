// T4.1 — konfig.json schema (Effect Schema).
//
// The CLI walks up from `cwd` to find a `konfig.json`, decodes it via this
// schema, and treats every path as relative to the directory containing
// `konfig.json`. See requirements.md §4 for the canonical reference.

import { Effect, Schema } from "effect";

// Helper: a string field that defaults to the given value when the key
// is absent from the JSON (not when it's explicitly null/undefined,
// since konfig.json is JSON so all values are present-or-absent).
const stringWithKeyDefault = (def: string) =>
	Schema.String.pipe(Schema.optionalKey, Schema.withDecodingDefaultKey(Effect.succeed(def)));

const stringArrayWithKeyDefault = (def: ReadonlyArray<string>) =>
	Schema.Array(Schema.String).pipe(
		Schema.optionalKey,
		Schema.withDecodingDefaultKey(Effect.succeed(def)),
	);

// `envs.<name>` entry shape. Each named env has a single `entry`
// pointing at the TS file that `export default AppOfApps.make(...)`.
export const EnvEntry = Schema.Struct({
	entry: Schema.String,
});
export type EnvEntry = typeof EnvEntry.Type;

// `outDir.manifests` — required. M4's `konfig build` writes
// `<root>/<outDir.manifests>/<env>/<App>/<Kind>-<name>.yaml` here.
export const OutDir = Schema.Struct({
	manifests: Schema.String,
});
export type OutDir = typeof OutDir.Type;

// `crd.outDir` — defaults to `.generated/crd` per FR-8.3.
export const CrdConfig = Schema.Struct({
	outDir: stringWithKeyDefault(".generated/crd"),
});
export type CrdConfig = typeof CrdConfig.Type;

// `helm.cacheDir` + `helm.minVersion` — defaults per FR-8.3.
export const HelmConfig = Schema.Struct({
	cacheDir: stringWithKeyDefault(".konfig/helm-cache"),
	minVersion: stringWithKeyDefault("3.16.0"),
});
export type HelmConfig = typeof HelmConfig.Type;

// `diff.baseline` — required when `konfig diff` is used. Path is relative
// to the konfig.json directory; `..` segments are allowed (FR-8.4).
export const DiffConfig = Schema.Struct({
	baseline: Schema.String,
});
export type DiffConfig = typeof DiffConfig.Type;

// `services.outFile` + `services.globalPaths` — both optional.
// `outFile` is the write target for `konfig services --format apps-json-v1`.
export const ServicesConfig = Schema.Struct({
	outFile: Schema.optionalKey(Schema.String),
	globalPaths: stringArrayWithKeyDefault([]),
});
export type ServicesConfig = typeof ServicesConfig.Type;

// Root `konfig.json` shape. Unknown top-level keys are rejected (FR-8.5)
// via the default strict-mode of Schema.Struct.
export const KonfigConfig = Schema.Struct({
	root: Schema.String,
	cluster: stringWithKeyDefault("cluster.ts"),
	modules: stringWithKeyDefault("modules"),
	charts: stringWithKeyDefault("charts"),
	envs: Schema.Record(Schema.String, EnvEntry),
	outDir: OutDir,
	crd: Schema.optionalKey(CrdConfig).pipe(
		Schema.withDecodingDefaultKey(Effect.succeed({ outDir: ".generated/crd" })),
	),
	helm: Schema.optionalKey(HelmConfig).pipe(
		Schema.withDecodingDefaultKey(
			Effect.succeed({ cacheDir: ".konfig/helm-cache", minVersion: "3.16.0" }),
		),
	),
	diff: Schema.optionalKey(DiffConfig),
	services: Schema.optionalKey(ServicesConfig),
});
export type KonfigConfig = typeof KonfigConfig.Type;

// Resolved config + the directory the config lives in. Every path in
// the config is interpreted relative to `configDir`.
export interface ResolvedKonfigConfig {
	readonly configDir: string;
	readonly config: KonfigConfig;
}

// Strict-mode decoder per FR-8.5: unknown top-level keys are rejected.
// `onExcessProperty: "error"` is a decode-time option, so the strictness
// can't live on the schema itself — every consumer should go through this
// helper instead of bare `Schema.decodeUnknownSync(KonfigConfig)`.
const strict = { onExcessProperty: "error" } as const;
const decodeSync = Schema.decodeUnknownSync(KonfigConfig);
const decodeEff = Schema.decodeUnknownEffect(KonfigConfig);

export const decodeKonfigConfigSync = (input: unknown): KonfigConfig => decodeSync(input, strict);
export const decodeKonfigConfigEffect = (input: unknown) => decodeEff(input, strict);
