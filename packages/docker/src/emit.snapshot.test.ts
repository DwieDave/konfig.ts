import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";
import { emit } from "./render/emit";
import type { DockerSpec } from "./spec";

const FIXTURES = new URL("../fixtures/", import.meta.url).pathname;

const minimal = (target: string): DockerSpec => ({
	target,
	runner: {
		workdir: "/app/packages/app",
		copy: [{ _tag: "BuilderArtifact", src: "dist", dst: "dist" }],
		cmd: ["bun", "run", "dist/main.js"],
	},
});

const fullFeatured = (target: string): DockerSpec => ({
	target,
	sharedRootFiles: [],
	runner: {
		workdir: "/app/packages/app",
		copy: [
			{ _tag: "BuilderArtifact", src: "dist", dst: "dist" },
			{ _tag: "WorkspaceSourceAll" },
		],
		env: { LOG_LEVEL: "info", NODE_ENV: "production" },
		expose: [4000, 9229],
		cmd: ["bun", "run", "dist/main.js"],
		user: { _tag: "UserNonRoot", uid: 1234, gid: 1234, name: "myapp" },
		healthcheck: { _tag: "HealthcheckHttpGet", path: "/healthz", port: 4000, interval: "30s" },
		platform: { _tag: "PlatformLinuxAmd64" },
	},
	dev: {
		cmd: ["bun", "--watch", "main.ts"],
		env: { DEBUG: "1" },
		expose: 4000,
	},
});

describe("emit snapshots — bun fixture", () => {
	it.effect("minimal spec", () =>
		Effect.gen(function* () {
			const out = yield* emit({
				spec: minimal(`${FIXTURES}bun/packages/app`),
				specPath: "packages/app/docker.ts",
			});
			expect(out.dockerfile).toMatchSnapshot("bun-minimal-Dockerfile");
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("full-featured spec", () =>
		Effect.gen(function* () {
			const out = yield* emit({
				spec: fullFeatured(`${FIXTURES}bun/packages/app`),
				specPath: "packages/app/docker.ts",
			});
			expect(out.dockerfile).toMatchSnapshot("bun-full-Dockerfile");
			expect(out.dockerfileDev).toMatchSnapshot("bun-full-Dockerfile.dev");
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("emit snapshots — npm fixture", () => {
	it.effect("minimal spec", () =>
		Effect.gen(function* () {
			const out = yield* emit({
				spec: minimal(`${FIXTURES}npm/packages/app`),
				specPath: "packages/app/docker.ts",
			});
			expect(out.dockerfile).toMatchSnapshot("npm-minimal-Dockerfile");
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("emit snapshots — pnpm-isolated fixture", () => {
	it.effect("minimal spec", () =>
		Effect.gen(function* () {
			const out = yield* emit({
				spec: minimal(`${FIXTURES}pnpm-isolated/packages/app`),
				specPath: "packages/app/docker.ts",
			});
			expect(out.dockerfile).toMatchSnapshot("pnpm-isolated-minimal-Dockerfile");
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("emit snapshots — pnpm-hoisted fixture", () => {
	it.effect("minimal spec", () =>
		Effect.gen(function* () {
			const out = yield* emit({
				spec: minimal(`${FIXTURES}pnpm-hoisted/packages/app`),
				specPath: "packages/app/docker.ts",
			});
			expect(out.dockerfile).toMatchSnapshot("pnpm-hoisted-minimal-Dockerfile");
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("emit determinism (NFR-2)", () => {
	it.effect("two runs of bun minimal produce byte-identical output", () =>
		Effect.gen(function* () {
			const spec = minimal(`${FIXTURES}bun/packages/app`);
			const a = yield* emit({ spec, specPath: "packages/app/docker.ts" });
			const b = yield* emit({ spec, specPath: "packages/app/docker.ts" });
			expect(a.dockerfile).toBe(b.dockerfile);
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});
