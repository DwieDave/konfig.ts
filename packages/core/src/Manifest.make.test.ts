import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import * as Manifest from "./Manifest";
import { RenderContext } from "./RenderContext";

describe("Manifest.make", () => {
	const ctx = RenderContext.make("test");

	it("accepts an Effect-returning thunk", async () => {
		const m = Manifest.make<{ kind: string }>(() => Effect.succeed({ kind: "X" }));
		const result = await Effect.runPromise(m.render(ctx));
		expect(result).toEqual({ kind: "X" });
	});

	it("accepts a plain value-returning thunk", async () => {
		const m = Manifest.make<{ kind: string }>(() => ({ kind: "X" }));
		const result = await Effect.runPromise(m.render(ctx));
		expect(result).toEqual({ kind: "X" });
	});

	it("treats a returned Effect as the effectful result, not as data", async () => {
		// A nested Effect must not be auto-wrapped — Effect.isEffect detects it.
		const m = Manifest.make<number>(() => Effect.succeed(7));
		const result = await Effect.runPromise(m.render(ctx));
		expect(result).toBe(7);
	});

	it("passes through the render context", async () => {
		const seen: string[] = [];
		const m = Manifest.make<string>((c) => {
			seen.push(c.env);
			return c.env;
		});
		const result = await Effect.runPromise(m.render(ctx));
		expect(seen).toEqual(["test"]);
		expect(result).toBe("test");
	});
});
