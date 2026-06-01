import { Effect, Layer } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import { Application, Module, SyncWave } from "./index";

const source: Application.ArgoSource = {
	repoURL: "ssh://git@github.com/example/infra.git",
	targetRevision: "main",
	path: "./infra/k8s/manifests/prod/sops-secrets-operator",
};

const runHandle = <Name extends string, Out, In>(
	handle: Application.ApplicationHandle<Name, Out, In>,
): Application.Application =>
	Effect.runSync(
		(Effect.gen(function* () {
			return yield* handle;
		}) as Effect.Effect<Application.Application, never, never>).pipe(
			Effect.provide(handle.layer as Layer.Layer<Out, never, never>),
		),
	);

describe("Module.fixedNs", () => {
	const defineSops = Module.fixedNs({
		namespace: "sops",
		annotations: SyncWave(-1),
		build: ({ name, namespace }, opts: { readonly note?: string }) => [
			{ kind: "ServiceAccount", name, namespace, note: opts.note },
		],
	});

	it("preserves the chosen name as a literal in the result type", () => {
		const sops = defineSops({ name: "sops-secrets-operator", source });

		type NameOf<T> = T extends Application.ApplicationHandle<infer N, infer _Out, infer _In> ? N : never;
		expectTypeOf<NameOf<typeof sops>>().toEqualTypeOf<"sops-secrets-operator">();
	});

	it("bakes the configured namespace into every instance", () => {
		const sops = defineSops({ name: "sops-secrets-operator", source });
		const app = runHandle(sops);

		expect(app.name).toBe("sops-secrets-operator");
		expect(app.namespace).toBe("sops");
		expect(app.annotations).toEqual({ "argocd.argoproj.io/sync-wave": "-1" });
		expect(app.manifests).toEqual([
			{ kind: "ServiceAccount", name: "sops-secrets-operator", namespace: "sops", note: undefined },
		]);
	});

	it("threads module-specific opts to the build callback", () => {
		const sops = defineSops({
			name: "sops-secrets-operator",
			source,
			note: "hello",
		});
		const app = runHandle(sops);

		expect(app.manifests).toEqual([
			{ kind: "ServiceAccount", name: "sops-secrets-operator", namespace: "sops", note: "hello" },
		]);
	});

	it("accepts an Effect-returning build", () => {
		const defineWithEffect = Module.fixedNs({
			namespace: "demo",
			build: ({ name, namespace }, _opts: {}) =>
				Effect.succeed([{ kind: "Cm", name, namespace }]),
		});

		const handle = defineWithEffect({ name: "demo-app", source });
		const app = runHandle(handle);

		expect(app.manifests).toEqual([{ kind: "Cm", name: "demo-app", namespace: "demo" }]);
	});

	it("rejects bare `string` for name at the call site", () => {
		const dynamicName = "x" as string;
		// @ts-expect-error — `name` must be a literal, `string` is rejected by LiteralName
		defineSops({ name: dynamicName, source });
	});
});

describe("Module.dynamicNs", () => {
	const defineApi = Module.dynamicNs({
		annotations: SyncWave(1),
		build: ({ name, namespace }, opts: { readonly image: string }) => [
			{ kind: "Deployment", name, namespace, image: opts.image },
		],
	});

	it("preserves both chosen name and namespace as literals", () => {
		const api = defineApi({
			name: "api",
			namespace: "prod",
			source,
			image: "ghcr.io/example/api:1.0",
		});

		type NameOf<T> = T extends Application.ApplicationHandle<infer N, infer _Out, infer _In> ? N : never;
		expectTypeOf<NameOf<typeof api>>().toEqualTypeOf<"api">();
	});

	it("uses the per-instance namespace in the resulting Application", () => {
		const apiProd = defineApi({
			name: "api",
			namespace: "prod",
			source,
			image: "ghcr.io/example/api:1.0",
		});
		const apiStaging = defineApi({
			name: "api-staging",
			namespace: "staging",
			source,
			image: "ghcr.io/example/api:1.0",
		});

		expect(runHandle(apiProd).namespace).toBe("prod");
		expect(runHandle(apiStaging).namespace).toBe("staging");
	});

	it("rejects bare `string` for namespace at the call site", () => {
		const dynamicNs = "x" as string;
		defineApi({
			name: "api",
			// @ts-expect-error — `namespace` must be a literal
			namespace: dynamicNs,
			source,
			image: "x",
		});
	});
});
