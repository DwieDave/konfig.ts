import { describe, expect, it } from "vitest";
import { DockerAppTypeId, isDockerApp, makeDockerApp } from "./Docker";
import type { DockerSpec } from "./spec";

const sampleSpec: DockerSpec = {
	target: "apps/x",
	runner: {
		workdir: "/app",
		copy: [],
		cmd: ["bun", "run", "main.ts"],
	},
};

describe("Docker brand", () => {
	it("makeDockerApp produces an object carrying the brand symbol", () => {
		const app = makeDockerApp(sampleSpec);
		expect(DockerAppTypeId in app).toBe(true);
		expect(app.spec).toBe(sampleSpec);
	});

	it("isDockerApp accepts a branded value", () => {
		const app = makeDockerApp(sampleSpec);
		expect(isDockerApp(app)).toBe(true);
	});

	it("isDockerApp rejects a plain spec object", () => {
		expect(isDockerApp(sampleSpec)).toBe(false);
	});

	it("isDockerApp rejects null, undefined, and primitives", () => {
		expect(isDockerApp(null)).toBe(false);
		expect(isDockerApp(undefined)).toBe(false);
		expect(isDockerApp("docker")).toBe(false);
		expect(isDockerApp(42)).toBe(false);
	});

	it("isDockerApp rejects an object that merely has a spec field", () => {
		expect(isDockerApp({ spec: sampleSpec })).toBe(false);
	});
});
