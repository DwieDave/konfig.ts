import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { decodeDockerSpec, type DockerSpec } from "./spec";

const minimalValid = {
	target: "apps/kanban/server",
	runner: {
		workdir: "/app/apps/kanban/server",
		copy: [{ _tag: "BuilderArtifact", src: "dist", dst: "dist" }],
		cmd: ["bun", "run", "dist/main.js"],
	},
} as const;

const fullValid = {
	target: "@konfig.ts/core",
	packageManager: { _tag: "BunPm" },
	runtime: { _tag: "BunRuntime", alpine: true },
	build: { _tag: "BuildScript", script: "build" },
	sharedRootFiles: ["tsconfig.base.json"],
	runner: {
		workdir: "/app",
		copy: [
			{ _tag: "BuilderArtifact", src: "dist", dst: "dist" },
			{ _tag: "WorkspaceSource", name: "@konfig.ts/core" },
			{ _tag: "WorkspaceSourceAll" },
			{ _tag: "CopyPath", src: "/etc/x", dst: "/etc/x" },
		],
		env: { NODE_ENV: "production", PORT: "4000" },
		expose: 4000,
		cmd: ["bun", "run", "dist/main.js"],
		user: { _tag: "UserNonRoot", uid: 1001, name: "bunjs" },
		healthcheck: {
			_tag: "HealthcheckHttpGet",
			path: "/healthz",
			port: 4000,
			interval: "30s",
			retries: 3,
		},
		platform: { _tag: "PlatformLinuxAmd64" },
	},
	dev: {
		cmd: ["bun", "--watch", "main.ts"],
		env: { NODE_ENV: "development" },
		expose: [4000, 9229],
	},
} as const;

describe("DockerSpec Schema", () => {
	it("decodes a minimal valid spec", () => {
		const exit = Effect.runSyncExit(decodeDockerSpec(minimalValid));
		expect(Exit.isSuccess(exit)).toBe(true);
		if (Exit.isSuccess(exit)) {
			const decoded: DockerSpec = exit.value;
			expect(decoded.target).toBe("apps/kanban/server");
			expect(decoded.runner.cmd).toEqual(["bun", "run", "dist/main.js"]);
		}
	});

	it("decodes a fully-populated spec with every atom family", () => {
		const exit = Effect.runSyncExit(decodeDockerSpec(fullValid));
		expect(Exit.isSuccess(exit)).toBe(true);
		if (Exit.isSuccess(exit)) {
			const d = exit.value;
			expect(d.runner.copy).toHaveLength(4);
			expect(d.runner.user?._tag).toBe("UserNonRoot");
			expect(d.runner.healthcheck?._tag).toBe("HealthcheckHttpGet");
			expect(d.dev?.cmd).toEqual(["bun", "--watch", "main.ts"]);
		}
	});

	it("rejects a spec missing required runner.cmd", () => {
		const exit = Effect.runSyncExit(
			decodeDockerSpec({
				target: "x",
				runner: { workdir: "/x", copy: [] },
			}),
		);
		expect(Exit.isFailure(exit)).toBe(true);
	});

	it("rejects an env value that looks like a secret (sk_ prefix)", () => {
		const exit = Effect.runSyncExit(
			decodeDockerSpec({
				...minimalValid,
				runner: { ...minimalValid.runner, env: { STRIPE_KEY: "sk_live_abcdef" } },
			}),
		);
		expect(Exit.isFailure(exit)).toBe(true);
	});

	it("rejects an env value that looks like a base64 secret", () => {
		const exit = Effect.runSyncExit(
			decodeDockerSpec({
				...minimalValid,
				runner: {
					...minimalValid.runner,
					env: { TOKEN: "AAAAB3NzaC1yc2EAAAADAQABAAABAQDFooBar1234567890" },
				},
			}),
		);
		expect(Exit.isFailure(exit)).toBe(true);
	});

	it("accepts a normal env value", () => {
		const exit = Effect.runSyncExit(
			decodeDockerSpec({
				...minimalValid,
				runner: { ...minimalValid.runner, env: { NODE_ENV: "production", PORT: "4000" } },
			}),
		);
		expect(Exit.isSuccess(exit)).toBe(true);
	});

	it("rejects an out-of-range port", () => {
		const exit = Effect.runSyncExit(
			decodeDockerSpec({
				...minimalValid,
				runner: { ...minimalValid.runner, expose: 99999 },
			}),
		);
		expect(Exit.isFailure(exit)).toBe(true);
	});

	it("decodes platform multi", () => {
		const exit = Effect.runSyncExit(
			decodeDockerSpec({
				...minimalValid,
				runner: {
					...minimalValid.runner,
					platform: { _tag: "PlatformMulti", values: ["linux/amd64", "linux/arm64"] },
				},
			}),
		);
		expect(Exit.isSuccess(exit)).toBe(true);
	});
});
