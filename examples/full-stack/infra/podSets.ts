import { selector } from "@konfig.ts/k8s";

/**
 * Shared SelectorBundles for the pod sets in this composition.
 *
 * `Workload.web` synthesizes pod selectors internally as
 * `{ app: <workload-name> }`. The bundles below mirror that scheme so
 * that NetworkPolicy peers and any future `bundledService` /
 * `podSetResources` consumer can reference the *same* literal label
 * record without re-typing it.
 *
 * If a workload moves off `Workload.web` to the round-1 prototype-2
 * primitives (`bundledDeployment` / `bundledService`), swap its
 * definition here to import the bundle from the module's own export
 * — then every netpol that selects that pod set follows automatically.
 *
 * `redisCachePods` already uses the lower-level primitives in
 * `modules/redis-cache.ts`.
 */
export const apiPods = selector({ app: "api" });
export const workerPods = selector({ app: "worker" });
export const redisCachePods = selector({ app: "redis", role: "cache" });
