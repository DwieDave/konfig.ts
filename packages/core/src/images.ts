// M12 — image tag inventory (`images.json`).
//
// CI bumps image tags via `konfig set <env> <app> <image>` — a one-shot
// mutation that reads the JSON, decodes it, writes back the mutated
// object, then re-decodes to confirm the result is still schema-valid.
// Env files load the JSON at module-load time and pull tags out by
// `images.envs.<env>.<app>`.
//
// The set of apps tracked here is open: callers decide which app keys
// are CI-mutated and which images stay pinned inline in module code.

import { Data, Effect, Schema } from "effect";

// Per-env app→image map. Keys are arbitrary app names; values are the
// fully-qualified image references CI rewrites.
export const EnvImages = Schema.Record(Schema.String, Schema.String);
export type EnvImages = typeof EnvImages.Type;

// Top-level `images.json` shape. Envs are open (Record) so new envs
// can be added without touching this file.
export const ImagesConfig = Schema.Struct({
	envs: Schema.Record(Schema.String, EnvImages),
});
export type ImagesConfig = typeof ImagesConfig.Type;

const decodeSync = Schema.decodeUnknownSync(ImagesConfig);
const decodeEff = Schema.decodeUnknownEffect(ImagesConfig);

// Strict decoder — rejects unknown top-level keys. Use this in env
// files so a stray field surfaces immediately.
const strict = { onExcessProperty: "error" } as const;

export const decodeImagesSync = (input: unknown): ImagesConfig => decodeSync(input, strict);
export const decodeImagesEffect = (input: unknown) => decodeEff(input, strict);

// Lookup helper. Fails the surrounding Effect if the env is missing
// from the JSON. Env files use the sync `imagesFor(...)` helper below;
// the Effect form is for the `konfig set` CLI.
export class ImagesEnvMissing extends Data.TaggedError("ImagesEnvMissing")<{
	readonly env: string;
}> {}

export const lookupEnv = (cfg: ImagesConfig, env: string): EnvImages | undefined =>
	cfg.envs[env];

export const lookupEnvEffect = (
	cfg: ImagesConfig,
	env: string,
): Effect.Effect<EnvImages, ImagesEnvMissing> => {
	const e = cfg.envs[env];
	return e === undefined ? Effect.fail(new ImagesEnvMissing({ env })) : Effect.succeed(e);
};

// Synchronous env-file helper. Throws `ImagesEnvMissing` if the env
// isn't in the JSON. Returns an `EnvImages` object with the typed
// optional fields.
export const imagesFor = (cfg: ImagesConfig, env: string): EnvImages => {
	const e = cfg.envs[env];
	if (e === undefined) {
		throw new ImagesEnvMissing({ env });
	}
	return e;
};

// Thrown when an env file asks for an app's image tag that the env's
// `images.json` block doesn't declare. Fails at module-load time so
// `konfig validate` surfaces it before render starts.
export class ImagesAppMissing extends Data.TaggedError("ImagesAppMissing")<{
	readonly env: string;
	readonly app: string;
}> {}

// Lookup helper for env files. `requireImage(prodImages, "web", "prod")`
// returns the tag or throws if the app isn't declared for that env.
export const requireImage = (
	e: EnvImages,
	app: string,
	envName: string,
): string => {
	const v = e[app];
	if (v === undefined) {
		throw new ImagesAppMissing({ env: envName, app });
	}
	return v;
};
