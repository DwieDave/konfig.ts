import { it } from "@effect/vitest";
import { ConfigProvider, Effect } from "effect";
import { describe, expect } from "vitest";
import { Downward } from "./downward";

describe("Downward", () => {
	it("carries metadata", () => {
		const pod = Downward.define({ envName: "POD_NAME", fieldPath: "metadata.name" });
		expect(pod._kind).toBe("Downward");
		expect(pod.envName).toBe("POD_NAME");
		expect(pod.fieldPath).toBe("metadata.name");
		expect(pod.envClaims).toEqual([
			{ envName: "POD_NAME", label: "Downward(POD_NAME)" },
		]);
	});

	it.effect("yields the env var the downward-API entry will set", () =>
		Effect.gen(function* () {
			const pod = Downward.define({ envName: "POD_NAME", fieldPath: "metadata.name" });
			const v = yield* pod;
			expect(v).toBe("api-7c9d8");
		}).pipe(
			Effect.provide(
				ConfigProvider.layer(
					ConfigProvider.fromEnv({ env: { POD_NAME: "api-7c9d8" } }),
				),
			),
		),
	);
});
