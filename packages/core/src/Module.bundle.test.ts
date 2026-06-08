import { Effect, Layer } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as Bundle from "./Bundle";
import * as Module from "./Module";

const runHandle = <Name extends string, Out, In>(
	handle: Bundle.BundleHandle<Name, Out, In>,
): Bundle.Bundle =>
	Effect.runSync(
		(Effect.gen(function* () {
			return yield* handle;
		}) as Effect.Effect<Bundle.Bundle, never, never>).pipe(
			Effect.provide(handle.layer as Layer.Layer<Out, never, never>),
		),
	);

describe("Module.fixedNs({ target: Bundle.target, ... })", () => {
	const defineCertManager = Module.fixedNs({
		target: Bundle.target,
		namespace: "cert-manager",
		build: ({ name, namespace }, opts: { readonly version?: string }) => [
			{ kind: "Namespace", name: namespace },
			{ kind: "Bundle", name, namespace, version: opts.version ?? "default" },
		],
	});

	it("preserves the chosen name as a literal", () => {
		const cm = defineCertManager({ name: "cert-manager" });

		type NameOf<T> = T extends Bundle.BundleHandle<infer N, infer _Out, infer _In> ? N : never;
		expectTypeOf<NameOf<typeof cm>>().toEqualTypeOf<"cert-manager">();
	});

	it("bakes the configured namespace and runs the build", () => {
		const cm = defineCertManager({ name: "cert-manager", version: "v1.14" });
		const bundle = runHandle(cm);

		expect(bundle.name).toBe("cert-manager");
		expect(bundle.namespace).toBe("cert-manager");
		expect(bundle.manifests).toEqual([
			{ kind: "Namespace", name: "cert-manager" },
			{ kind: "Bundle", name: "cert-manager", namespace: "cert-manager", version: "v1.14" },
		]);
	});

	it("rejects bare `string` for name at the call site", () => {
		const dynamicName = "x" as string;
		// @ts-expect-error — `name` must be a literal
		defineCertManager({ name: dynamicName });
	});
});

describe("Module.dynamicNs({ target: Bundle.target, ... })", () => {
	const defineCache = Module.dynamicNs({
		target: Bundle.target,
		build: ({ name, namespace }, opts: { readonly sizeGi: number }) => [
			{ kind: "Pvc", name, namespace, sizeGi: opts.sizeGi },
		],
	});

	it("uses the per-instance namespace", () => {
		const prod = defineCache({ name: "cache", namespace: "prod", sizeGi: 50 });
		const staging = defineCache({ name: "cache", namespace: "staging", sizeGi: 10 });

		expect(runHandle(prod).namespace).toBe("prod");
		expect(runHandle(staging).namespace).toBe("staging");
		expect(runHandle(prod).manifests).toEqual([
			{ kind: "Pvc", name: "cache", namespace: "prod", sizeGi: 50 },
		]);
	});

	it("rejects bare `string` for namespace at the call site", () => {
		const dynamicNs = "x" as string;
		defineCache({
			name: "cache",
			// @ts-expect-error — `namespace` must be a literal
			namespace: dynamicNs,
			sizeGi: 1,
		});
	});
});
