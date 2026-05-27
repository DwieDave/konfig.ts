import { describe, expect, it } from "vitest";
import { bun as bunPm } from "./pm/bun";
import { npm as npmPm } from "./pm/npm";
import { pnpm as pnpmPm } from "./pm/pnpm";
import { bun as bunRuntime } from "./runtime/bun";
import { node as nodeRuntime } from "./runtime/node";

describe("PackageManager bun", () => {
	it("matches snapshot", () => {
		expect({
			tag: bunPm._tag,
			lockfiles: bunPm.lockfileNames,
			aux: bunPm.auxFiles,
			install: bunPm.installCommand,
			layout: bunPm.nodeModulesLayout,
			prepend: bunPm.prependDepsRuns("1.3.5"),
		}).toMatchInlineSnapshot(`
			{
			  "aux": [
			    "bunfig.toml",
			  ],
			  "install": [
			    "bun",
			    "install",
			    "--ignore-scripts",
			  ],
			  "layout": "isolated",
			  "lockfiles": [
			    "bun.lock",
			  ],
			  "prepend": [],
			  "tag": "Bun",
			}
		`);
	});

	it("depsImage returns the runtime image unchanged", () => {
		const out = bunPm.depsImage({
			runtimeImage: { image: "oven/bun", tag: "1.3.5-alpine" },
			pmVersion: "1.3.5",
		});
		expect(out).toEqual({ image: "oven/bun", tag: "1.3.5-alpine" });
	});
});

describe("PackageManager npm", () => {
	it("matches snapshot", () => {
		expect({
			tag: npmPm._tag,
			lockfiles: npmPm.lockfileNames,
			aux: npmPm.auxFiles,
			install: npmPm.installCommand,
			layout: npmPm.nodeModulesLayout,
		}).toMatchInlineSnapshot(`
			{
			  "aux": [
			    ".npmrc",
			  ],
			  "install": [
			    "npm",
			    "ci",
			    "--ignore-scripts",
			  ],
			  "layout": "isolated",
			  "lockfiles": [
			    "package-lock.json",
			  ],
			  "tag": "Npm",
			}
		`);
	});
});

describe("PackageManager pnpm", () => {
	it("isolated layout snapshot", () => {
		const p = pnpmPm({ layout: "isolated" });
		expect({
			tag: p._tag,
			lockfiles: p.lockfileNames,
			aux: p.auxFiles,
			install: p.installCommand,
			layout: p.nodeModulesLayout,
			prepend: p.prependDepsRuns("9.7.0"),
		}).toMatchInlineSnapshot(`
			{
			  "aux": [
			    ".npmrc",
			  ],
			  "install": [
			    "pnpm",
			    "install",
			    "--frozen-lockfile",
			    "--ignore-scripts",
			  ],
			  "layout": "isolated",
			  "lockfiles": [
			    "pnpm-lock.yaml",
			    "pnpm-workspace.yaml",
			  ],
			  "prepend": [
			    "corepack enable pnpm && corepack prepare pnpm@9.7.0 --activate",
			  ],
			  "tag": "Pnpm",
			}
		`);
	});

	it("hoisted layout flips nodeModulesLayout", () => {
		const p = pnpmPm({ layout: "hoisted" });
		expect(p.nodeModulesLayout).toBe("hoisted");
	});
});

describe("Runtime bun", () => {
	it("imageRef with alpine", () => {
		expect(bunRuntime.imageRef({ version: "1.3.5", alpine: true })).toEqual({
			image: "oven/bun",
			tag: "1.3.5-alpine",
		});
	});

	it("imageRef without alpine", () => {
		expect(bunRuntime.imageRef({ version: "1.3.5", alpine: false })).toEqual({
			image: "oven/bun",
			tag: "1.3.5",
		});
	});

	it("defaultDevWatch", () => {
		expect(bunRuntime.defaultDevWatch("main.ts")).toEqual(["bun", "--watch", "main.ts"]);
	});
});

describe("Runtime node", () => {
	it("imageRef with alpine", () => {
		expect(nodeRuntime.imageRef({ version: "22", alpine: true })).toEqual({
			image: "node",
			tag: "22-alpine",
		});
	});

	it("imageRef without alpine", () => {
		expect(nodeRuntime.imageRef({ version: "22", alpine: false })).toEqual({
			image: "node",
			tag: "22",
		});
	});

	it("defaultDevWatch", () => {
		expect(nodeRuntime.defaultDevWatch("dist/main.js")).toEqual([
			"node",
			"--watch",
			"dist/main.js",
		]);
	});
});
