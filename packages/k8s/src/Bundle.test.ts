import { Dep } from "@konfig.ts/core";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import * as Bundle from "./Bundle";
import { define } from "./Bundle";

describe("Bundle.make", () => {
	it("constructs a Bundle with the given fields", () => {
		const b = Bundle.make({
			name: "api",
			namespace: "app",
			manifests: [{ kind: "ConfigMap", metadata: { name: "api-conf" } }],
		});
		expect(b.name).toBe("api");
		expect(b.namespace).toBe("app");
		expect(b.manifests).toHaveLength(1);
	});

	it("omits namespace when not provided", () => {
		const b = Bundle.make({ name: "cluster-scoped", manifests: [] });
		expect(b.namespace).toBeUndefined();
	});
});

describe("Bundle.define", () => {
	it("returns a yieldable handle whose value is the built Bundle", async () => {
		const handle = define({
			name: "api",
			namespace: "app",
			build: () => [{ kind: "ConfigMap", metadata: { name: "api-conf" } }],
		});

		const program = Effect.gen(function* () {
			const b = yield* handle;
			expect(b.name).toBe("api");
			expect(b.namespace).toBe("app");
			expect(b.manifests).toHaveLength(1);
		});
		await Effect.runPromise(
			program.pipe(Effect.provide(handle.layer)) as Effect.Effect<void, never, never>,
		);
	});

	it("supports an Effect-returning build that reads from a provided Layer", async () => {
		const handle = define({
			name: "consumer",
			namespace: "app",
			build: Effect.gen(function* () {
				const ref = yield* Dep.Secret("shared");
				return [{ kind: "ConfigMap", metadata: { name: ref } }];
			}),
		});

		const providerLayer = Dep.provideSecret("shared");
		const program = Effect.gen(function* () {
			const b = yield* handle;
			expect(b.manifests[0]).toEqual({
				kind: "ConfigMap",
				metadata: { name: "shared" },
			});
		});
		await Effect.runPromise(
			program.pipe(
				Effect.provide(Layer.provideMerge(handle.layer, providerLayer)),
			) as Effect.Effect<void, never, never>,
		);
	});

	it("supports a cluster-scoped bundle with no namespace", async () => {
		const handle = define({
			name: "crds",
			build: () => [
				{ kind: "CustomResourceDefinition", metadata: { name: "foos.example.com" } },
			],
		});

		const program = Effect.gen(function* () {
			const b = yield* handle;
			expect(b.namespace).toBeUndefined();
			expect(b.name).toBe("crds");
		});
		await Effect.runPromise(
			program.pipe(Effect.provide(handle.layer)) as Effect.Effect<void, never, never>,
		);
	});
});
