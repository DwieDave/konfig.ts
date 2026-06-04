/**
 * SelectorBundle — one source of truth for "this pod set."
 *
 * A SelectorBundle wraps a literal label record (`{ app: "api" }`,
 * `{ app: "api", tier: "web" }`, …) and brands it in a phantom type
 * parameter. Resources that *select* pods — Deployment.selector,
 * Service.selector, NetworkPolicy.podSelector, HPA target — can take
 * the bundle directly via `bundledDeployment`/`bundledService`/
 * `bundledNetworkPolicy`, so a drift across three resources (the
 * classic "service has no endpoints / netpol denies everything" bug)
 * becomes a compile error.
 *
 * `Workload.web` already keeps these labels coherent internally; the
 * bundle is the win when users go off-script: StatefulSet, DaemonSet,
 * cross-namespace selectors, or wiring a NetworkPolicy from app A to
 * peer pods B.
 */
declare const SelectorBundleBrand: unique symbol;

export interface SelectorBundle<L extends Readonly<Record<string, string>>> {
	readonly [SelectorBundleBrand]: L;
	readonly labels: L;
}

/**
 * Construct a SelectorBundle from a literal label record. Use `as const`
 * on the input (or call with an object literal — the `const` type
 * parameter narrows automatically) to preserve the literal types.
 *
 *   const apiPods = selector({ app: "api", tier: "web" });
 */
export const selector = <const L extends Readonly<Record<string, string>>>(
	labels: L,
): SelectorBundle<L> => ({ labels }) as unknown as SelectorBundle<L>;

export type SelectorBundleLabels<B> = B extends SelectorBundle<infer L> ? L : never;
