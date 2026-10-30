import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { unsafeCoerce } from "@konfig.ts/core"
import { Effect } from "effect"
import { describe, expect } from "vitest"
import type { Deployment as K8sDeployment, Ingress as K8sIngress, Service as K8sService } from "./.generated/k8s-types"
import { ConfigMapRef, SecretRef } from "./refs"
import { web } from "./workloadHelpers"

const coerce = <T, V = unknown>(value: V): T =>
  unsafeCoerce<T, V>({ value: value, reason: "the rendered manifest is the K8s resource its builder emits" })

const ctx = { env: "prod" } as const

describe("Workload.web pod labels", () => {
  it.effect("a colliding user pod label cannot shadow the app selector label", () =>
    Effect.gen(function*() {
      const manifest = web({
        name: "api",
        namespace: "prod",
        deployment: {
          containers: [{ name: "app", image: "nginx" }],
          podLabels: { app: "not-api", tier: "web" }
        },
        service: { ports: [{ port: 80, targetPort: 80 }] }
      })

      const [deployment] = yield* manifest.render(ctx)
      const dep = coerce<K8sDeployment>(deployment)
      expect(dep.spec?.selector.matchLabels).toEqual({ app: "api" })
      expect(dep.spec?.template.metadata?.labels).toEqual({ app: "api", tier: "web" })
      expect(dep.spec?.selector.matchLabels).toBeDefined()
      expect(dep.spec?.template.metadata?.labels?.app).toBe(
        dep.spec?.selector.matchLabels?.app
      )
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("Workload.web reloader annotations", () => {
  const baseInput = {
    name: "api",
    namespace: "prod",
    deployment: { containers: [{ name: "app", image: "nginx" }] },
    service: { ports: [{ port: 80, targetPort: 80 }] }
  }

  it.effect("reloader 'off' (default) adds no reloader annotations", () =>
    Effect.gen(function*() {
      const manifest = web(baseInput)
      const [deployment] = yield* manifest.render(ctx)
      const dep = coerce<K8sDeployment>(deployment)
      expect(dep.metadata?.annotations ?? {}).toEqual({})
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("reloader 'stakater' adds only the auto annotation", () =>
    Effect.gen(function*() {
      const manifest = web({ ...baseInput, reloader: "stakater" })
      const [deployment] = yield* manifest.render(ctx)
      const dep = coerce<K8sDeployment>(deployment)
      expect(dep.metadata?.annotations).toEqual({ "reloader.stakater.com/auto": "true" })
    }).pipe(Effect.provide(NodeServices.layer)))

  it("reloader 'stakater-strict' is no longer accepted", () => {
    // @ts-expect-error removed option
    const manifest = web({ ...baseInput, reloader: "stakater-strict" })
    expect(manifest).toBeDefined()
  })

  it.effect("reloader explicit secrets/configMaps are comma-joined into distinct annotation keys", () =>
    Effect.gen(function*() {
      const manifest = web({
        ...baseInput,
        reloader: { secrets: [SecretRef.of("s1"), SecretRef.of("s2")], configMaps: [ConfigMapRef.of("cm1")] }
      })

      const [deployment] = yield* manifest.render(ctx)
      const dep = coerce<K8sDeployment>(deployment)
      expect(dep.metadata?.annotations).toEqual({
        "secret.reloader.stakater.com/reload": "s1,s2",
        "configmap.reloader.stakater.com/reload": "cm1"
      })
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("reloader explicit with empty arrays adds no annotations", () =>
    Effect.gen(function*() {
      const manifest = web({ ...baseInput, reloader: { secrets: [], configMaps: [] } })
      const [deployment] = yield* manifest.render(ctx)
      const dep = coerce<K8sDeployment>(deployment)
      expect(dep.metadata?.annotations ?? {}).toEqual({})
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("reloader explicit with only secrets set adds only the secret annotation", () =>
    Effect.gen(function*() {
      const manifest = web({ ...baseInput, reloader: { secrets: [SecretRef.of("only-secret")] } })
      const [deployment] = yield* manifest.render(ctx)
      const dep = coerce<K8sDeployment>(deployment)
      expect(dep.metadata?.annotations).toEqual({ "secret.reloader.stakater.com/reload": "only-secret" })
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("Workload.web without ingress", () => {
  it.effect("renders exactly [Deployment, Service] with matching selector labels", () =>
    Effect.gen(function*() {
      const manifest = web({
        name: "api",
        namespace: "prod",
        labels: { team: "platform" },
        annotations: { owner: "platform-team" },
        deployment: {
          replicas: 2,
          containers: [{ name: "app", image: "nginx" }]
        },
        service: { ports: [{ port: 80, targetPort: 8080 }], type: "ClusterIP" }
      })

      const rendered = yield* manifest.render(ctx)
      expect(rendered).toHaveLength(2)
      const [deployment, service] = rendered
      const dep = coerce<K8sDeployment>(deployment)
      const svc = coerce<K8sService>(service)
      expect(dep.kind).toBe("Deployment")
      expect(dep.spec?.replicas).toBe(2)
      expect(dep.metadata?.labels).toEqual({ app: "api", team: "platform" })
      expect(svc.kind).toBe("Service")
      expect(svc.spec?.selector).toEqual({ app: "api" })
      expect(svc.spec?.type).toBe("ClusterIP")
      expect(svc.spec?.ports).toEqual([{ port: 80, targetPort: 8080 }])
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("service defaults to ClusterIP when type is unset", () =>
    Effect.gen(function*() {
      const manifest = web({
        name: "api",
        namespace: "prod",
        deployment: { containers: [{ name: "app", image: "nginx" }] },
        service: { ports: [{ port: 80, targetPort: 80 }] }
      })

      const [, service] = yield* manifest.render(ctx)
      const svc = coerce<K8sService>(service)
      expect(svc.spec?.type).toBe("ClusterIP")
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("Workload.web with ingress", () => {
  it.effect("renders [Deployment, Service, Ingress] with merged annotations", () =>
    Effect.gen(function*() {
      const manifest = web({
        name: "api",
        namespace: "prod",
        annotations: { owner: "platform-team" },
        deployment: { containers: [{ name: "app", image: "nginx" }] },
        service: { ports: [{ port: 80, targetPort: 80 }] },
        ingress: {
          ingressClassName: "nginx",
          annotations: { "nginx.ingress.kubernetes.io/rewrite-target": "/" },
          rules: [{ host: "api.example.com" }]
        }
      })

      const rendered = yield* manifest.render(ctx)
      expect(rendered).toHaveLength(3)
      const ingress = coerce<K8sIngress>(rendered[2])
      expect(ingress.kind).toBe("Ingress")
      expect(ingress.spec?.ingressClassName).toBe("nginx")
      expect(ingress.spec?.rules).toEqual([{ host: "api.example.com" }])
      expect(ingress.metadata?.annotations).toEqual({
        owner: "platform-team",
        "nginx.ingress.kubernetes.io/rewrite-target": "/"
      })
      expect(ingress.metadata?.labels).toEqual({ app: "api" })
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("Workload.web annotations", () => {
  it.effect("omits metadata.annotations when none are supplied", () =>
    Effect.gen(function*() {
      const manifest = web({
        name: "api",
        namespace: "prod",
        deployment: { containers: [{ name: "app", image: "nginx" }] },
        service: { ports: [{ port: 80, targetPort: 80 }] }
      })

      const [deployment] = yield* manifest.render(ctx)
      expect(coerce<K8sDeployment>(deployment).metadata?.annotations).toBeUndefined()
    }).pipe(Effect.provide(NodeServices.layer)))
})
