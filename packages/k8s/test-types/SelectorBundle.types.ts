// Compile-time assertions for SelectorBundle<L> coherence. Two
// distinct bundles are not assignable to each other; consumers
// (bundledDeployment / bundledService / bundledNetworkPolicy /
// podSetResources) refuse to mix label sets across resources.

import type { SelectorBundle, SelectorBundleLabels } from "@konfig.ts/k8s";
import {
	bundledDeployment,
	bundledService,
	podSetResources,
	selector,
} from "@konfig.ts/k8s";

type Expect<T extends true> = T;
type Equal<X, Y> =
	(<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

// 1 · `selector` preserves the literal label record.
const apiPods = selector({ app: "api", tier: "web" });
type ApiLabels = SelectorBundleLabels<typeof apiPods>;
type _ApiLabels = Expect<Equal<ApiLabels, { readonly app: "api"; readonly tier: "web" }>>;

const dbPods = selector({ app: "postgres" });
type DbLabels = SelectorBundleLabels<typeof dbPods>;
type _DbLabels = Expect<Equal<DbLabels, { readonly app: "postgres" }>>;

// 2 · Distinct bundles are not mutually assignable.
type _NotAssignable = Expect<
	Equal<typeof dbPods extends SelectorBundle<ApiLabels> ? true : false, false>
>;

// 3 · Bundled consumers accept the matching bundle.
const _okDep = bundledDeployment({
	name: "api",
	namespace: "default",
	podSet: apiPods,
	template: { spec: { containers: [{ name: "api", image: "x" }] } },
});

const _okSvc = bundledService({
	name: "api",
	namespace: "default",
	podSet: apiPods,
	ports: [{ port: 80 }],
});

// 4 · `podSetResources` infers L from `podSet` and rejects a mismatched
//     sub-resource. Here, attempting to claim a fixed-label deployment
//     for a different bundle is the kind of error we want to catch —
//     the umbrella's L is inferred from `podSet`, so the sub-input is
//     implicitly typed to it (no separate bundle to mismatch).
const _okTrio = podSetResources({
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

// 5 · A SelectorBundle<L> can't be silently substituted with a different L.
//     Annotate the variable; assignment of `dbPods` triggers the brand
//     mismatch (different `labels` literal types).
// @ts-expect-error - SelectorBundle<{app:"postgres"}> not assignable to SelectorBundle<{app:"api",tier:"web"}>.
const _wrongAssign: typeof apiPods = dbPods;

void _okDep;
void _okSvc;
void _okTrio;
void _wrongAssign;

export type _Tests = readonly [_ApiLabels, _DbLabels, _NotAssignable];
