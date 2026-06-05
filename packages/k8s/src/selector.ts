/**
 * Selector — one source of truth for "this pod set."
 *
 * `Selector<L>` wraps a literal label record and brands it. Resources
 * that *select* pods — Deployment.selector, Service.selector,
 * NetworkPolicy.podSelector, HPA target — take the bundle directly via
 * `Deployment.fromPodSet` / `Service.fromPodSet` / `NetworkPolicy.fromPodSet`
 * so a drift across three resources (the classic "service has no
 * endpoints / netpol denies everything" bug) becomes a compile error.
 *
 * `Workload.web` already keeps these labels coherent internally; the
 * Selector is the win when users go off-script: StatefulSet, DaemonSet,
 * cross-namespace selectors, or wiring a NetworkPolicy from app A to
 * peer pods B.
 */
declare const SelectorBrand: unique symbol;

export interface Selector<L extends Readonly<Record<string, string>>> {
	readonly [SelectorBrand]: L;
	readonly labels: L;
}

/**
 * `Selector` value namespace.
 *
 *   const apiPods = Selector.make({ app: "api", tier: "web" });
 */
export const Selector = {
	make: <const L extends Readonly<Record<string, string>>>(labels: L): Selector<L> =>
		({ labels }) as unknown as Selector<L>,
};

export type SelectorLabels<S> = S extends Selector<infer L> ? L : never;
