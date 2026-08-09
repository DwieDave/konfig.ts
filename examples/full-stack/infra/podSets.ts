import { Selector } from "@konfig.ts/k8s"

// Mirrors Workload.web's internal `{ app: <name> }` selector scheme so NetworkPolicy peers reuse the same labels.
export const apiPods = Selector.make({ app: "api" })
export const workerPods = Selector.make({ app: "worker" })
export const redisCachePods = Selector.make({ app: "redis", role: "cache" })
