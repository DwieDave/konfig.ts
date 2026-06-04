import { describe, expect, it } from "vitest";
import { computeOutputHash } from "./buildCache";

describe("computeOutputHash", () => {
	it("is deterministic regardless of input order", () => {
		const a = [
			{ path: "out/a.yaml", content: "kind: A\n" },
			{ path: "out/b.yaml", content: "kind: B\n" },
		];
		const b = [
			{ path: "out/b.yaml", content: "kind: B\n" },
			{ path: "out/a.yaml", content: "kind: A\n" },
		];
		expect(computeOutputHash(a)).toBe(computeOutputHash(b));
	});

	it("changes when any file content changes", () => {
		const base = computeOutputHash([{ path: "x.yaml", content: "a: 1\n" }]);
		const flipped = computeOutputHash([{ path: "x.yaml", content: "a: 2\n" }]);
		expect(base).not.toBe(flipped);
	});

	it("changes when any path changes", () => {
		const a = computeOutputHash([{ path: "x.yaml", content: "k\n" }]);
		const b = computeOutputHash([{ path: "y.yaml", content: "k\n" }]);
		expect(a).not.toBe(b);
	});

	it("returns a SHA-256 hex string", () => {
		const h = computeOutputHash([{ path: "x", content: "y" }]);
		expect(h).toMatch(/^[0-9a-f]{64}$/);
	});
});
