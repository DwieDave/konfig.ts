import { Application } from "@konfig.ts/argocd"
import { Module } from "@konfig.ts/core"
import { Container, Deployment, NetworkPolicy, Port, Service } from "@konfig.ts/k8s"
import { apiPods, redisCachePods, workerPods } from "../podSets"

// Redis cache sidecar, built without `Workload.web`. `Deployment.fromPodSet` derives selector labels from the same `Selector` used by the
// netpol and Service, so the "Service has no endpoints" label-drift footgun is structurally impossible.
// Vendor image stays a raw string — no in-tree build, so no `Dep.Image` needed.
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
