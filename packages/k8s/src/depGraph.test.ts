import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import { Bundle, Dep, Manifest, RenderContext } from "@konfig.ts/core"
import type {
  ConfigMapRef as CoreConfigMapRef,
  PvcRef as CorePvcRef,
  ServiceAccountRef as CoreSaRef
} from "@konfig.ts/core"
import { Effect, Layer } from "effect"
import { expectTypeOf } from "vitest"
import { EnvVar } from "./env"
import { ConfigMap, ServiceAccount } from "./identity"
import { PersistentVolumeClaim } from "./policy"
import { type ConfigMapRef, PvcRef, type ServiceAccountRef } from "./refs"
import { Volume } from "./volume"
import { Deployment } from "./workload"

const settings = ConfigMap.make({ name: "settings", namespace: "infra", data: { LOG_LEVEL: "debug" } })

const worker = ServiceAccount.make({ name: "worker", namespace: "app" })

const data = PvcRef.of("data")

const claim = PersistentVolumeClaim.make({
  name: data,
  namespace: "app",
  spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: "1Gi" } } }
})

const provider = Bundle.define({
  name: "provider",
  namespace: "infra",
  build: () => [settings, worker, claim],
  provides: Layer.mergeAll(
    Layer.succeed(Dep.ConfigMap<"settings", "LOG_LEVEL">("settings"))(settings.ref),
    Layer.succeed(Dep.ServiceAccount("worker"))(worker.ref),
    Dep.providePvc("data")
  )
})

const consumer = Bundle.define({
  name: "consumer",
  namespace: "app",
  build: Effect.gen(function*() {
    const cm = yield* Dep.ConfigMap<"settings", "LOG_LEVEL">("settings")
    const sa = yield* Dep.ServiceAccount("worker")
    const pvc = yield* Dep.Pvc("data")

    return [
      Deployment.make({
        name: "api",
        namespace: "app",
        selector: { matchLabels: { app: "api" } },
        template: {
          metadata: { labels: { app: "api" } },
          spec: {
            serviceAccountName: sa,
            volumes: [Volume.fromConfigMap({ name: "cfg", ref: cm }), Volume.fromPvc({ name: "data", claim: pvc })],
            containers: [{
              name: "api",
              image: "api",
              env: EnvVar.configMapEnv({ ref: cm, map: { LOG: "LOG_LEVEL" } })
            }]
          }
        }
      })
    ]
  })
})

const ctx = RenderContext.make("test")

layer(NodeServices.layer)("k8s builders in the Dep graph", (it) => {
  it.effect("a consumer yields the ConfigMap, ServiceAccount and Pvc refs another module provides", () =>
    Effect.gen(function*() {
      const result = yield* Bundle.fromModules({ modules: [provider, consumer] as const })
      const manifests = result.bundles.find((b) => b.name === "consumer")?.manifests ?? []
      const rendered = yield* Effect.forEach(manifests.filter(Manifest.isManifest), (m) => m.render(ctx))

      expect(rendered).toMatchObject([{
        kind: "Deployment",
        spec: {
          template: {
            spec: {
              serviceAccountName: "worker",
              volumes: [
                { name: "cfg", configMap: { name: "settings" } },
                { name: "data", persistentVolumeClaim: { claimName: "data" } }
              ],
              containers: [{
                env: [{ name: "LOG", valueFrom: { configMapKeyRef: { name: "settings", key: "LOG_LEVEL" } } }]
              }]
            }
          }
        }
      }])
    }))

  it("builder refs are the core brands the Dep services carry", () => {
    expectTypeOf(settings.ref).toEqualTypeOf<CoreConfigMapRef<"settings", "LOG_LEVEL">>()
    expectTypeOf(worker.ref).toEqualTypeOf<CoreSaRef<"worker">>()
    expectTypeOf<ServiceAccountRef<"worker">>().toEqualTypeOf<CoreSaRef<"worker">>()
    expectTypeOf<ConfigMapRef<"settings">>().toEqualTypeOf<CoreConfigMapRef<"settings">>()
    expectTypeOf(data).toEqualTypeOf<CorePvcRef<"data">>()
  })

  it("a consumer listed before its provider leaves the need unsatisfied", () => {
    // @ts-expect-error ConfigMap "settings" has no earlier provider
    Bundle.fromModules({ modules: [consumer, provider] as const })
    expect(consumer.layer).toBeDefined()
  })
})
