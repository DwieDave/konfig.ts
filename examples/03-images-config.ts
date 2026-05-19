
import {
	decodeImagesSync,
	ImagesAppMissing,
	ImagesEnvMissing,
	imagesFor,
	requireImage,
} from "@konfig.ts/core";

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

const prod = imagesFor({ cfg, env: "prod" });
process.stdout.write(`prod.web → ${requireImage({ e: prod, app: "web", envName: "prod" })}\n`);
process.stdout.write(`prod.api → ${requireImage({ e: prod, app: "api", envName: "prod" })}\n`);

const staging = imagesFor({ cfg, env: "staging" });
process.stdout.write(
	`staging.web → ${requireImage({ e: staging, app: "web", envName: "staging" })}\n`,
);

try {
	imagesFor({ cfg, env: "preview" });
} catch (e) {
	if (e instanceof ImagesEnvMissing) {
		process.stdout.write(`✗ env "${e.env}" not in images.json\n`);
	}
}

try {
	requireImage({ e: staging, app: "api", envName: "staging" });
} catch (e) {
	if (e instanceof ImagesAppMissing) {
		process.stdout.write(`✗ app "${e.app}" not declared for env "${e.env}"\n`);
	}
}

try {
	decodeImagesSync({
		envs: { prod: {} },
		version: 2, // ← not in the schema
	});
} catch {
	process.stdout.write(`✗ unknown top-level key "version" → rejected\n`);
}
