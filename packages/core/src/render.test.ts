import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { _buildLayers, _resolveEnv } from "./render";
import { RenderContext } from "./RenderContext";

describe("render — env resolution", () => {
	it("defaults env to 'prod' when no option is passed", () => {
		expect(_resolveEnv(undefined)).toBe("prod");
	});

	it("uses the provided env when set", () => {
		expect(_resolveEnv("staging")).toBe("staging");
	});

	it("produces a RenderContext from the resolved env", () => {
		const ctx = RenderContext.make(_resolveEnv("preview"));
		expect(ctx.env).toBe("preview");
	});
});

describe("render — layer composition", () => {
	it("returns NodeServices.layer alone when no extra layer is provided", () => {
		const built = _buildLayers(undefined);
		// Both layers are opaque values; we assert reference identity with NodeServices.layer.
		expect(built).toBe(NodeServices.layer);
	});

	it("merges NodeServices.layer with the caller's layer when provided", async () => {
		const extra = Layer.empty;
		const built = _buildLayers(extra);
		expect(built).not.toBe(NodeServices.layer);
		// The merged layer should still be providable to a program — the merge is
		// well-typed and the resulting layer satisfies a trivial Effect.
		await Effect.runPromise(Effect.succeed("ok").pipe(Effect.provide(built)));
	});
});
