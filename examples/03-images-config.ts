// Example 3 — Schema-validated image config
//
// `images.json` holds the per-env image-tag inventory. CI bumps tags
// via `konfig set <env> <app> <image>` — a one-shot mutation that
// reads the JSON, decodes through an Effect Schema, mutates the
// in-memory value, then re-decodes before writing back. The same
// schema decode runs at module-load time in env files, so a corrupt
// or malformed `images.json` fails fast with a structured error
// rather than surfacing as a confusing render later.
//
// The payoff: one source of truth for the JSON shape. Unknown keys
// are rejected. Missing env or app lookups raise tagged errors with
// the offending key — turn-key for the CLI's exit code and for env
// files that want to fail at load rather than at render.
//
// Run: bun examples/03-images-config.ts

import {
	decodeImagesSync,
	ImagesAppMissing,
	ImagesEnvMissing,
	imagesFor,
	requireImage,
} from "@konfig.ts/core";

// ── Decode an inline `images.json`. ────────────────────────────────
//
// The schema is open: any string env, any string app. Each value is
// a fully-qualified image reference.

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

// Lookup helpers — these are what env files call at module-load time.
const prod = imagesFor(cfg, "prod");
process.stdout.write(`prod.web → ${requireImage(prod, "web", "prod")}\n`);
process.stdout.write(`prod.api → ${requireImage(prod, "api", "prod")}\n`);

const staging = imagesFor(cfg, "staging");
process.stdout.write(`staging.web → ${requireImage(staging, "web", "staging")}\n`);

// ── Failure mode 1: unknown env. ───────────────────────────────────

try {
	imagesFor(cfg, "preview");
} catch (e) {
	if (e instanceof ImagesEnvMissing) {
		process.stdout.write(`✗ env "${e.env}" not in images.json\n`);
	}
}

// ── Failure mode 2: app not declared for the env. ──────────────────

try {
	requireImage(staging, "api", "staging");
} catch (e) {
	if (e instanceof ImagesAppMissing) {
		process.stdout.write(`✗ app "${e.app}" not declared for env "${e.env}"\n`);
	}
}

// ── Failure mode 3: schema rejects unknown top-level keys. ─────────
//
// `onExcessProperty: "error"` is wired into the decoder so a typo at
// the top level (`env` vs. `envs`, or a stray `version` field) fails
// instantly rather than being silently dropped.

try {
	decodeImagesSync({
		envs: { prod: {} },
		version: 2, // ← not in the schema
	});
} catch {
	process.stdout.write(`✗ unknown top-level key "version" → rejected\n`);
}
