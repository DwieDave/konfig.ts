import { Application } from "@konfig.ts/argocd"
import { Module } from "@konfig.ts/core"
import { Container, Deployment, NetworkPolicy, Port, Service } from "@konfig.ts/k8s"
import { apiPods, redisCachePods, workerPods } from "../podSets"

/**
 * Redis cache sidecar — demonstrates round-1 prototypes 1 and 2
 * end-to-end without going through `Workload.web`.
 *
 *   - `Container.define({ ports: [Port.make({ name: "redis", ... })] })`
 *     captures the literal port-name union ("redis") and constrains
 *     the readiness probe's `tcpSocket.port` to it.
 *
 *   - `Deployment.fromPodSet({ podSet: redisCachePods, ... })` derives
 *     `spec.selector.matchLabels` AND `template.metadata.labels` from
 *     the same `Selector` — drift between the two (a classic
 *     "Service has no endpoints" footgun) is structurally impossible.
 *
 *   - `Service.fromContainer({ forContainer: redisContainer, ... })`
 *     ties `targetPort` to the container's port-name union via NoInfer —
 *     `targetPort: Port.ref("rdis")` is a compile-time error, not a
 *     "unable to find named port" pod-startup failure.
 *
 *   - `NetworkPolicy.fromPodSet({ podSet, ingress: [{ from: [{ podSet }] }] })`
 *     restricts ingress to the api and worker pod sets (imported as
 *     `Selector`s from `infra/podSets.ts`). The same label record
 *     drives Workload.web's internal selectors AND this netpol's
 *     `spec.ingress[].from[].podSelector` — single source of truth.
 *
 * The redis image stays as a raw string (the BuiltImageRef escape
 * hatch for vendor images) — there's no in-tree build for upstream
 * containers, so no `Dep.Image` is required.
 */
export const defineRedisCache = Module.fixedNs({
  target: Application.target,
  namespace: "app",
  build: ({ name, namespace }, _opts: Record<never, never>) => {
    const redisContainer = Container.define({
      name: "redis",
      image: "docker.io/library/redis:7-alpine",
      ports: [Port.make({ name: "redis", containerPort: 6379 })],
      readinessProbe: {
        tcpSocket: { port: Port.ref("redis") },
        periodSeconds: 5
      }
    })

    const deployment = Deployment.fromPodSet({
      name,
      namespace,
      podSet: redisCachePods,
      replicas: 1,
      template: { spec: { containers: [redisContainer] } }
    })

    const service = Service.fromContainer({
      name,
      namespace,
      selector: redisCachePods.labels,
      forContainer: redisContainer,
      ports: [{ port: 6379, targetPort: Port.ref("redis") }]
    })

    const netpol = NetworkPolicy.fromPodSet({
      name: `${name}-ingress`,
      namespace,
      podSet: redisCachePods,
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [{ podSet: apiPods }, { podSet: workerPods }],
          ports: [{ port: 6379, protocol: "TCP" }]
        }
      ]
    })

    return [deployment, service, netpol]
  }
})
