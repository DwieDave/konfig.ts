import { Selector } from "@konfig.ts/k8s";

/**
 * Shared `Selector`s for the pod sets in this composition.
 *
 * `Workload.web` synthesizes pod selectors internally as
 * `{ app: <workload-name> }`. The selectors below mirror that scheme so
 * that NetworkPolicy peers and any future `bundledService` /
 * `podSetResources` consumer can reference the *same* literal label
 * record without re-typing it.
 *
 * If a workload moves off `Workload.web` to the round-1 prototype-2
 * primitives (`bundledDeployment` / `bundledService`), swap its
 * definition here to import the selector from the module's own export
 * — then every netpol that selects that pod set follows automatically.
 *
 * `redisCachePods` already uses the lower-level primitives in
 * `modules/redis-cache.ts`.
 */
export const apiPods = Selector.make({ app: "api" });
export const workerPods = Selector.make({ app: "worker" });
export const redisCachePods = Selector.make({ app: "redis", role: "cache" });
