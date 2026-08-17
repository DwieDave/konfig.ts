// Demonstrates: probes and Service ports must name a port the container actually declares.
import { Container, Port, Workload } from "@konfig.ts/k8s"

const api = Container.define({
  name: "api",
  image: "ghcr.io/example/api:1.0.0",
  ports: [Port.make({ name: "http", containerPort: 8080 })],
  readinessProbe: {
    // @ts-expect-error "htp" is not a declared port name ("http").
    httpGet: { path: "/healthz", port: Port.ref("htp") }
  }
})

const _wrongTarget = Workload.web({
  name: "api",
  namespace: "app",
  deployment: { containers: [api] },
  // @ts-expect-error "metrics" is not a port of any container in this workload.
  service: { ports: [{ port: 80, targetPort: Port.ref("metrics") }] }
})
void _wrongTarget

const _ok = Workload.web({
  name: "api",
  namespace: "app",
  deployment: { containers: [api] },
  service: { ports: [{ port: 80, targetPort: Port.ref("http") }] }
})
void _ok
