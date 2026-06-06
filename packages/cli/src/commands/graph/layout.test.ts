import { describe, expect, it } from "vitest";
import { detectCycle, renderGraph } from "./layout";

const node = (name: string, relDir: string, hasBuildScript = false) => ({
	name,
	relDir,
	hasBuildScript,
});

describe("renderGraph — single node", () => {
	it("returns a string containing the node name and relDir", () => {
		const out = renderGraph({
			nodes: [node("@s/api", "packages/api")],
			edges: [],
			target: "@s/api",
			width: 80,
			withDev: false,
		});
		expect(typeof out).toBe("string");
		expect(out).toContain("@s/api");
		expect(out).toContain("packages/api");
	});

	it("shows a build indicator when hasBuildScript is true", () => {
		const out = renderGraph({
			nodes: [node("@s/api", "packages/api", true)],
			edges: [],
			target: "@s/api",
			width: 80,
			withDev: false,
		});
		expect(out).toContain("build");
	});
});

describe("renderGraph — parent → child layered DAG", () => {
	it("places the child below the parent in line order", () => {
		const out = renderGraph({
			nodes: [
				node("@s/api", "packages/api"),
				node("@s/core", "packages/core"),
			],
			edges: [{ from: "@s/api", to: "@s/core", kind: "runtime" }],
			target: "@s/api",
			width: 200,
			withDev: false,
		});
		const apiIdx = out.indexOf("@s/api");
		const coreIdx = out.indexOf("@s/core");
		expect(apiIdx).toBeGreaterThanOrEqual(0);
		expect(coreIdx).toBeGreaterThan(apiIdx);
	});

	it("renders a diamond — the shared dep appears exactly once", () => {
		const out = renderGraph({
			nodes: [
				node("@s/api", "packages/api"),
				node("@s/core", "packages/core"),
				node("@s/auth", "packages/auth"),
				node("@s/utils", "packages/utils"),
			],
			edges: [
				{ from: "@s/api", to: "@s/core", kind: "runtime" },
				{ from: "@s/api", to: "@s/auth", kind: "runtime" },
				{ from: "@s/core", to: "@s/utils", kind: "runtime" },
				{ from: "@s/auth", to: "@s/utils", kind: "runtime" },
			],
			target: "@s/api",
			width: 200,
			withDev: false,
		});
		const matches = out.match(/@s\/utils/g);
		expect(matches).not.toBeNull();
		expect(matches?.length).toBe(1);
	});
});

describe("renderGraph — long edges (spanning multiple ranks)", () => {
	it("draws an arrow at the deep child even when the edge skips ranks", () => {
		const out = renderGraph({
			nodes: [
				node("@s/api", "packages/api"),
				node("@s/mid", "packages/mid"),
				node("@s/leaf", "packages/leaf"),
			],
			edges: [
				{ from: "@s/api", to: "@s/mid", kind: "runtime" },
				{ from: "@s/mid", to: "@s/leaf", kind: "runtime" },
				{ from: "@s/api", to: "@s/leaf", kind: "runtime" },
			],
			target: "@s/api",
			width: 200,
			withDev: false,
		});
		const arrowCount = (out.match(/▼/g) ?? []).length;
		expect(arrowCount).toBeGreaterThanOrEqual(3);
	});
});

describe("renderGraph — multi-connector bottom edge", () => {
	it("draws multiple ┬ stems on a parent with multiple children", () => {
		const out = renderGraph({
			nodes: [
				node("@s/api", "packages/api"),
				node("@s/a", "packages/a"),
				node("@s/b", "packages/b"),
				node("@s/c", "packages/c"),
			],
			edges: [
				{ from: "@s/api", to: "@s/a", kind: "runtime" },
				{ from: "@s/api", to: "@s/b", kind: "runtime" },
				{ from: "@s/api", to: "@s/c", kind: "runtime" },
			],
			target: "@s/api",
			width: 200,
			withDev: false,
		});
		const apiLine = out.split("\n").find((l) => l.includes("┘") && l.includes("└"));
		expect(apiLine).toBeDefined();
		const stemCount = (apiLine?.match(/┬/g) ?? []).length;
		expect(stemCount).toBe(3);
	});

	it("box bottom row always ends with ┘ (right corner intact)", () => {
		const out = renderGraph({
			nodes: [
				node("@s/api", "packages/api"),
				node("@s/x", "packages/x"),
			],
			edges: [{ from: "@s/api", to: "@s/x", kind: "runtime" }],
			target: "@s/api",
			width: 200,
			withDev: false,
		});
		const bottomLines = out
			.split("\n")
			.filter((l) => /└[─┬]+┘/.test(l));
		expect(bottomLines.length).toBeGreaterThan(0);
		for (const line of bottomLines) {
			const stripped = line.replace(/\s+$/, "");
			expect(/└[─┬]+┘/.test(stripped)).toBe(true);
		}
	});
});

describe("renderGraph — incoming arrows", () => {
	it("draws a ▼ arrow above a child for an incoming runtime edge", () => {
		const out = renderGraph({
			nodes: [
				node("@s/api", "packages/api"),
				node("@s/core", "packages/core"),
			],
			edges: [{ from: "@s/api", to: "@s/core", kind: "runtime" }],
			target: "@s/api",
			width: 200,
			withDev: false,
		});
		expect(out).toContain("▼");
	});
});

describe("renderGraph — transitive reduction", () => {
	it("hides A→C when A→B→C also exists, only when reduce is true", () => {
		const baseInput = {
			nodes: [
				node("@s/a", "packages/a"),
				node("@s/b", "packages/b"),
				node("@s/c", "packages/c"),
			],
			edges: [
				{ from: "@s/a", to: "@s/b", kind: "runtime" as const },
				{ from: "@s/b", to: "@s/c", kind: "runtime" as const },
				{ from: "@s/a", to: "@s/c", kind: "runtime" as const },
			],
			target: "@s/a",
			width: 200,
			withDev: false,
		};
		const full = renderGraph({ ...baseInput, reduce: false });
		const reduced = renderGraph({ ...baseInput, reduce: true });
		const fullArrows = (full.match(/▼/g) ?? []).length;
		const reducedArrows = (reduced.match(/▼/g) ?? []).length;
		expect(fullArrows).toBeGreaterThan(reducedArrows);
	});
});

describe("renderGraph — dev edges", () => {
	it("hides dev-only dependencies when withDev is false", () => {
		const out = renderGraph({
			nodes: [
				node("@s/api", "packages/api"),
				node("@s/tsconfig", "packages/tsconfig"),
			],
			edges: [{ from: "@s/api", to: "@s/tsconfig", kind: "dev" }],
			target: "@s/api",
			width: 200,
			withDev: false,
		});
		expect(out).not.toContain("@s/tsconfig");
	});

	it("shows dev-only dependencies when withDev is true", () => {
		const out = renderGraph({
			nodes: [
				node("@s/api", "packages/api"),
				node("@s/tsconfig", "packages/tsconfig"),
			],
			edges: [{ from: "@s/api", to: "@s/tsconfig", kind: "dev" }],
			target: "@s/api",
			width: 200,
			withDev: true,
		});
		expect(out).toContain("@s/tsconfig");
	});
});

describe("renderGraph — width fallback", () => {
	it("renders a tree fallback (┣/├/└ markers) when layer width exceeds the terminal", () => {
		const out = renderGraph({
			nodes: [
				node("@s/api", "packages/api"),
				node("@s/aaaaaaaaaaaaaa", "packages/aaa"),
				node("@s/bbbbbbbbbbbbbb", "packages/bbb"),
				node("@s/cccccccccccccc", "packages/ccc"),
				node("@s/dddddddddddddd", "packages/ddd"),
			],
			edges: [
				{ from: "@s/api", to: "@s/aaaaaaaaaaaaaa", kind: "runtime" },
				{ from: "@s/api", to: "@s/bbbbbbbbbbbbbb", kind: "runtime" },
				{ from: "@s/api", to: "@s/cccccccccccccc", kind: "runtime" },
				{ from: "@s/api", to: "@s/dddddddddddddd", kind: "runtime" },
			],
			target: "@s/api",
			width: 30,
			withDev: false,
		});
		expect(out).toMatch(/[├└]/);
		expect(out).toContain("@s/api");
		expect(out).toContain("@s/aaaaaaaaaaaaaa");
	});
});

describe("renderGraph — monorepo mode (no target)", () => {
	it("renders multiple roots when no target is provided", () => {
		const out = renderGraph({
			nodes: [
				node("@s/api", "packages/api"),
				node("@s/web", "packages/web"),
				node("@s/utils", "packages/utils"),
			],
			edges: [
				{ from: "@s/api", to: "@s/utils", kind: "runtime" },
				{ from: "@s/web", to: "@s/utils", kind: "runtime" },
			],
			target: undefined,
			width: 200,
			withDev: false,
		});
		expect(out).toContain("@s/api");
		expect(out).toContain("@s/web");
		expect(out).toContain("@s/utils");
		const apiIdx = out.indexOf("@s/api");
		const webIdx = out.indexOf("@s/web");
		const utilsIdx = out.indexOf("@s/utils");
		expect(utilsIdx).toBeGreaterThan(Math.max(apiIdx, webIdx));
	});
});

describe("detectCycle", () => {
	it("returns null for an acyclic graph", () => {
		const cycle = detectCycle({
			nodes: [node("a", "a"), node("b", "b")],
			edges: [{ from: "a", to: "b", kind: "runtime" }],
		});
		expect(cycle).toBeNull();
	});

	it("returns the cycle path for a simple cycle", () => {
		const cycle = detectCycle({
			nodes: [node("a", "a"), node("b", "b")],
			edges: [
				{ from: "a", to: "b", kind: "runtime" },
				{ from: "b", to: "a", kind: "runtime" },
			],
		});
		expect(cycle).not.toBeNull();
		expect(cycle).toContain("a");
		expect(cycle).toContain("b");
	});

	it("returns the cycle including a dev edge only when withDev is true", () => {
		const input = {
			nodes: [node("a", "a"), node("b", "b")],
			edges: [
				{ from: "a", to: "b", kind: "runtime" as const },
				{ from: "b", to: "a", kind: "dev" as const },
			],
		};
		expect(detectCycle({ ...input, withDev: false })).toBeNull();
		expect(detectCycle({ ...input, withDev: true })).not.toBeNull();
	});
});
