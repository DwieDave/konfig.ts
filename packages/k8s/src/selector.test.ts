import { render, RenderContext } from "@konfig.ts/core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
	bundledDeployment,
	bundledNetworkPolicy,
	bundledService,
	podSetResources,
} from "./podSet";
import { Selector } from "./selector";

const ctx = RenderContext.make("test");
const _run = <A>(eff: Effect.Effect<A, unknown>): Promise<A> =>
	Effect.runPromise(eff as Effect.Effect<A, never, never>);

describe("Selector.make", () => {
	it("carries labels as a readonly record at runtime", () => {
		const apiPods = Selector.make({ app: "api", tier: "web" });
		expect(apiPods.labels).toEqual({ app: "api", tier: "web" });
	});
});

describe("bundledDeployment", () => {
	it("uses the bundle's labels for both selector and template", async () => {
		const apiPods = Selector.make({ app: "api", tier: "web" });
		const dep = bundledDeployment({
			name: "api",
			namespace: "default",
			podSet: apiPods,
			replicas: 2,
			template: { spec: { containers: [{ name: "api", image: "x" }] } },
		});
		const out = await _run(render({ manifest: dep, ctx }));
		expect(out.spec?.selector.matchLabels).toEqual({ app: "api", tier: "web" });
		expect(out.spec?.template.metadata?.labels).toEqual({ app: "api", tier: "web" });
		expect(out.spec?.replicas).toBe(2);
	});

	it("merges extra template labels with the bundle's labels", async () => {
		const apiPods = Selector.make({ app: "api" });
		const dep = bundledDeployment({
			name: "api",
			namespace: "default",
			podSet: apiPods,
			template: {
				metadata: { labels: { version: "v1" } },
				spec: { containers: [{ name: "api", image: "x" }] },
			},
		});
		const out = await _run(render({ manifest: dep, ctx }));
		expect(out.spec?.template.metadata?.labels).toEqual({ app: "api", version: "v1" });
	});
});

describe("bundledService", () => {
	it("uses the bundle's labels as spec.selector", async () => {
		const apiPods = Selector.make({ app: "api" });
		const svc = bundledService({
			name: "api",
			namespace: "default",
			podSet: apiPods,
			ports: [{ port: 80, targetPort: 8080 }],
		});
		const out = await _run(render({ manifest: svc, ctx }));
		expect(out.spec?.selector).toEqual({ app: "api" });
		expect(out.spec?.ports?.[0]).toEqual({ port: 80, targetPort: 8080 });
	});
});

describe("bundledNetworkPolicy", () => {
	it("uses the bundle's labels as spec.podSelector and lowers ingress peers", async () => {
		const apiPods = Selector.make({ app: "api" });
		const dbPods = Selector.make({ app: "postgres" });
		const np = bundledNetworkPolicy({
			name: "api-ingress",
			namespace: "default",
			podSet: apiPods,
			policyTypes: ["Ingress"],
			ingress: [{ from: [{ podSet: dbPods }] }],
		});
		const out = await _run(render({ manifest: np, ctx }));
		expect(out.spec?.podSelector.matchLabels).toEqual({ app: "api" });
		expect(out.spec?.ingress?.[0]?.from?.[0]?.podSelector?.matchLabels).toEqual({
			app: "postgres",
		});
	});
});

describe("podSetResources", () => {
	it("emits a coherent Deployment + Service + NetworkPolicy from one bundle", async () => {
		const apiPods = Selector.make({ app: "api", tier: "web" });
		const dbPods = Selector.make({ app: "postgres" });
		const trio = podSetResources({
			podSet: apiPods,
			deployment: {
				name: "api",
				namespace: "default",
				replicas: 2,
				template: { spec: { containers: [{ name: "api", image: "x" }] } },
			},
			service: { name: "api", namespace: "default", ports: [{ port: 80 }] },
			netPol: {
				name: "api-ingress",
				namespace: "default",
				ingress: [{ from: [{ podSet: dbPods }] }],
			},
		});
		const out = await _run(render({ manifest: trio, ctx }));
		expect(out).toHaveLength(3);
		const [dep, svc, np] = out;
		expect(dep.spec?.selector.matchLabels).toEqual({ app: "api", tier: "web" });
		expect(svc?.spec?.selector).toEqual({ app: "api", tier: "web" });
		expect(np?.spec?.podSelector.matchLabels).toEqual({ app: "api", tier: "web" });
		expect(np?.spec?.ingress?.[0]?.from?.[0]?.podSelector?.matchLabels).toEqual({
			app: "postgres",
		});
	});
});
