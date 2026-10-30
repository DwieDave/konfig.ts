import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import { RenderContext } from "@konfig.ts/core"
import { Effect } from "effect"
import { describe, it } from "vitest"
import { Ingress, Service } from "./network"
import { SecretRef } from "./refs"

const ctx = RenderContext.make("test")

layer(NodeServices.layer)("Service.make", (it) => {
  it.effect("renders selector, type and untyped ports", () =>
    Effect.gen(function*() {
      const svc = Service.make({
        name: "api",
        namespace: "prod",
        labels: { app: "api" },
        selector: { app: "api" },
        type: "NodePort",
        ports: [{ name: "http", port: 80, targetPort: "http" }],
        sessionAffinity: "ClientIP"
      })

      const result = yield* svc.render(ctx)
      expect(result.apiVersion).toBe("v1")
      expect(result.kind).toBe("Service")
      expect(result.metadata).toEqual({ name: "api", namespace: "prod", labels: { app: "api" } })
      expect(result.spec?.selector).toEqual({ app: "api" })
      expect(result.spec?.type).toBe("NodePort")
      expect(result.spec?.ports).toEqual([{ name: "http", port: 80, targetPort: "http" }])
      expect(result.spec?.sessionAffinity).toBe("ClientIP")
    }))
})

layer(NodeServices.layer)("Ingress.make", (it) => {
  it.effect("renders class, rules, tls and defaultBackend", () =>
    Effect.gen(function*() {
      const ing = Ingress.make({
        name: "api",
        namespace: "prod",
        ingressClassName: "nginx",
        rules: [{ host: "api.example.com" }],
        tls: [Ingress.tls({ secretName: SecretRef.of("api-tls"), hosts: ["api.example.com"] })],
        defaultBackend: { service: { name: "api", port: { number: 80 } } }
      })

      const result = yield* ing.render(ctx)
      expect(result.apiVersion).toBe("networking.k8s.io/v1")
      expect(result.kind).toBe("Ingress")
      expect(result.spec?.ingressClassName).toBe("nginx")
      expect(result.spec?.rules).toEqual([{ host: "api.example.com" }])
      expect(result.spec?.tls).toEqual([{ secretName: "api-tls", hosts: ["api.example.com"] }])
      expect(result.spec?.defaultBackend).toEqual({ service: { name: "api", port: { number: 80 } } })
    }))
})

describe("Ingress.tls", () => {
  it("copies hosts instead of aliasing them", () => {
    const hosts = ["api.example.com"]
    const tls = Ingress.tls({ secretName: SecretRef.of("api-tls"), hosts })
    expect(tls).toEqual({ secretName: "api-tls", hosts })
    expect(tls.hosts).not.toBe(hosts)
  })
})
