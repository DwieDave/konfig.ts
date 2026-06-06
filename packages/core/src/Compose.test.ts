import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { composeLayers, makeResidualEntrypoint } from "./Compose";
import { Secret } from "./deps";
import { brand } from "./_cast";
import type { SecretRef } from "./deps";

describe("composeLayers", () => {
	it("supplies a sibling's Out as a later module's In (left-fold topo-sort)", async () => {
		const providerLayer = Layer.succeed(Secret("shared"))(
			brand<SecretRef<"shared">>("shared"),
		);
		const consumerLayer = Layer.effectDiscard(
			Effect.gen(function* () {
				const ref = yield* Secret("shared");
				expect(ref).toBe("shared");
			}),
		);
		const wired = composeLayers([{ layer: providerLayer }, { layer: consumerLayer }]);
		await Effect.runPromise(
			Layer.build(wired).pipe(Effect.scoped, Effect.asVoid),
		);
	});

	it("collapses to an empty layer when given no modules", async () => {
		const wired = composeLayers([]);
		await Effect.runPromise(
			Layer.build(wired).pipe(Effect.scoped, Effect.asVoid),
		);
	});
});

describe("makeResidualEntrypoint", () => {
	it("returns its input Effect unchanged at runtime", async () => {
		const entrypoint = makeResidualEntrypoint("Test.fromModules");
		const program = Effect.succeed("ok");
		const result = await Effect.runPromise(entrypoint(program));
		expect(result).toBe("ok");
	});
});
