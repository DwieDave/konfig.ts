
import {
	decodeImagesSync,
	ImagesAppMissing,
	ImagesEnvMissing,
	imagesFor,
	requireImage,
} from "@konfig.ts/core";
import { Data, Effect } from "effect";

class ImagesDecodeRejected extends Data.TaggedError("ImagesDecodeRejected") {}

const raw = {
	envs: {
		prod: {
			web: "ghcr.io/example/web:1.4.2",
			api: "ghcr.io/example/api:1.4.2",
		},
		staging: {
			web: "ghcr.io/example/web:beta",
		},
	},
};

const cfg = decodeImagesSync(raw);

const program = Effect.gen(function* () {
	const prod = imagesFor({ cfg, env: "prod" });
	yield* Effect.log(`prod.web → ${requireImage({ e: prod, app: "web", envName: "prod" })}`);
	yield* Effect.log(`prod.api → ${requireImage({ e: prod, app: "api", envName: "prod" })}`);

	const staging = imagesFor({ cfg, env: "staging" });
	yield* Effect.log(
		`staging.web → ${requireImage({ e: staging, app: "web", envName: "staging" })}`,
	);

	yield* Effect.try({
		try: () => imagesFor({ cfg, env: "preview" }),
		catch: (e) => (e instanceof ImagesEnvMissing ? e : new ImagesEnvMissing({ env: "preview" })),
	}).pipe(Effect.catch((e) => Effect.log(`✗ env "${e.env}" not in images.json`)));

	yield* Effect.try({
		try: () => requireImage({ e: staging, app: "api", envName: "staging" }),
		catch: (e) =>
			e instanceof ImagesAppMissing ? e : new ImagesAppMissing({ env: "staging", app: "api" }),
	}).pipe(Effect.catch((e) => Effect.log(`✗ app "${e.app}" not declared for env "${e.env}"`)));

	yield* Effect.try({
		try: () =>
			decodeImagesSync({
				envs: { prod: {} },
				version: 2,
			}),
		catch: () => new ImagesDecodeRejected(),
	}).pipe(Effect.catch(() => Effect.log(`✗ unknown top-level key "version" → rejected`)));
});

Effect.runPromise(program);
