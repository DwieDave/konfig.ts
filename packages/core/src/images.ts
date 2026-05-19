
import { Data, Effect, Schema } from "effect";

export const EnvImages = Schema.Record(Schema.String, Schema.String);
export type EnvImages = typeof EnvImages.Type;

export const ImagesConfig = Schema.Struct({
	envs: Schema.Record(Schema.String, EnvImages),
});
export type ImagesConfig = typeof ImagesConfig.Type;

const decodeEff = Schema.decodeUnknownEffect(ImagesConfig);

const strict = { onExcessProperty: "error" } as const;

export const decodeImagesSync = (input: unknown): ImagesConfig =>
	Effect.runSync(decodeEff(input, strict));
export const decodeImagesEffect = (input: unknown) => decodeEff(input, strict);

export class ImagesEnvMissing extends Data.TaggedError("ImagesEnvMissing")<{
	readonly env: string;
}> {}

export interface LookupEnvInput {
	readonly cfg: ImagesConfig;
	readonly env: string;
}
export const lookupEnv = (input: LookupEnvInput): EnvImages | undefined =>
	input.cfg.envs[input.env];

export const lookupEnvEffect = (
	input: LookupEnvInput,
): Effect.Effect<EnvImages, ImagesEnvMissing> => {
	const e = input.cfg.envs[input.env];
	return e === undefined ? Effect.fail(new ImagesEnvMissing({ env: input.env })) : Effect.succeed(e);
};

export const imagesFor = (input: LookupEnvInput): EnvImages => {
	const e = input.cfg.envs[input.env];
	if (e === undefined) {
		throw new ImagesEnvMissing({ env: input.env });
	}
	return e;
};

export class ImagesAppMissing extends Data.TaggedError("ImagesAppMissing")<{
	readonly env: string;
	readonly app: string;
}> {}

export interface RequireImageInput {
	readonly e: EnvImages;
	readonly app: string;
	readonly envName: string;
}
export const requireImage = (input: RequireImageInput): string => {
	const v = input.e[input.app];
	if (v === undefined) {
		throw new ImagesAppMissing({ env: input.envName, app: input.app });
	}
	return v;
};
