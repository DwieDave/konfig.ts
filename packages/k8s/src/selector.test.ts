import { renderManifest, RenderContext } from "@konfig.ts/core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { Service } from "./network";
import { PodSet } from "./podSet";
import { NetworkPolicy } from "./policy";
import { Selector } from "./selector";
import { Deployment } from "./workload";

const ctx = RenderContext.make("test");
const _run = <A>(eff: Effect.Effect<A, unknown>): Promise<A> =>
	Effect.runPromise(eff as Effect.Effect<A, never, never>);

describe("Selector.make", () => {
	it("carries labels as a readonly record at runtime", () => {
		const apiPods = Selector.make({ app: "api", tier: "web" });
		expect(apiPods.labels).toEqual({ app: "api", tier: "web" });
	});
});

describe("Deployment.fromPodSet", () => {
	it("uses the selector's labels for both selector and template", async () => {
		const apiPods = Selector.make({ app: "api", tier: "web" });
		const dep = Deployment.fromPodSet({
			name: "api",
			namespace: "default",
			podSet: apiPods,
			replicas: 2,
			template: { spec: { containers: [{ name: "api", image: "x" }] } },
		});
		const out = await _run(renderManifest({ manifest: dep, ctx }));
		expect(out.spec?.selector.matchLabels).toEqual({ app: "api", tier: "web" });
		expect(out.spec?.template.metadata?.labels).toEqual({ app: "api", tier: "web" });
		expect(out.spec?.replicas).toBe(2);
	});

	it("merges extra template labels with the selector's labels", async () => {
		const apiPods = Selector.make({ app: "api" });
		const dep = Deployment.fromPodSet({
			name: "api",
			namespace: "default",
			podSet: apiPods,
			template: {
				metadata: { labels: { version: "v1" } },
				spec: { containers: [{ name: "api", image: "x" }] },
			},
		});
		const out = await _run(renderManifest({ manifest: dep, ctx }));
		expect(out.spec?.template.metadata?.labels).toEqual({ app: "api", version: "v1" });
	});
});

describe("Service.fromPodSet", () => {
	it("uses the selector's labels as spec.selector", async () => {
		const apiPods = Selector.make({ app: "api" });
		const svc = Service.fromPodSet({
			name: "api",
			namespace: "default",
			podSet: apiPods,
			ports: [{ port: 80, targetPort: 8080 }],
		});
		const out = await _run(renderManifest({ manifest: svc, ctx }));
		expect(out.spec?.selector).toEqual({ app: "api" });
		expect(out.spec?.ports?.[0]).toEqual({ port: 80, targetPort: 8080 });
	});
});

describe("NetworkPolicy.fromPodSet", () => {
	it("uses the selector's labels as spec.podSelector and lowers ingress peers", async () => {
		const apiPods = Selector.make({ app: "api" });
		const dbPods = Selector.make({ app: "postgres" });
		const np = NetworkPolicy.fromPodSet({
			name: "api-ingress",
			namespace: "default",
			podSet: apiPods,
			policyTypes: ["Ingress"],
			ingress: [{ from: [{ podSet: dbPods }] }],
		});
		const out = await _run(renderManifest({ manifest: np, ctx }));
		expect(out.spec?.podSelector.matchLabels).toEqual({ app: "api" });
		expect(out.spec?.ingress?.[0]?.from?.[0]?.podSelector?.matchLabels).toEqual({
			app: "postgres",
		});
	});
});

describe("PodSet", () => {
	it("emits a coherent Deployment + Service + NetworkPolicy from one selector", async () => {
		const apiPods = Selector.make({ app: "api", tier: "web" });
		const dbPods = Selector.make({ app: "postgres" });
		const trio = PodSet.define({
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
		const out = await _run(renderManifest({ manifest: trio, ctx }));
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
