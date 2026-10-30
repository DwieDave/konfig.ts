import { NodeServices } from "@effect/platform-node"
import { describe, expect, it, layer } from "@effect/vitest"
import { RenderContext, renderManifest } from "@konfig.ts/core"
import { Effect } from "effect"
import { NetworkPolicy } from "./policy"
import { Selector } from "./selector"
import { Deployment } from "./workload"

const ctx = RenderContext.make("test")

describe("Selector.make", () => {
  it("carries labels as a readonly record at runtime", () => {
    const apiPods = Selector.make({ app: "api", tier: "web" })
    expect(apiPods.labels).toEqual({ app: "api", tier: "web" })
  })
})

layer(NodeServices.layer)("Deployment.fromPodSet", (it) => {
  it.effect("uses the selector's labels for both selector and template", () =>
    Effect.gen(function*() {
      const apiPods = Selector.make({ app: "api", tier: "web" })

      const dep = Deployment.fromPodSet({
        name: "api",
        namespace: "default",
        podSet: apiPods,
        replicas: 2,
        template: { spec: { containers: [{ name: "api", image: "x" }] } }
      })

      const out = yield* renderManifest({ manifest: dep, ctx })
      expect(out.spec?.selector.matchLabels).toEqual({ app: "api", tier: "web" })
      expect(out.spec?.template.metadata?.labels).toEqual({ app: "api", tier: "web" })
      expect(out.spec?.replicas).toBe(2)
    }))

  it.effect("merges extra template labels with the selector's labels", () =>
    Effect.gen(function*() {
      const apiPods = Selector.make({ app: "api" })

      const dep = Deployment.fromPodSet({
        name: "api",
        namespace: "default",
        podSet: apiPods,
        template: {
          metadata: { labels: { version: "v1" } },
          spec: { containers: [{ name: "api", image: "x" }] }
        }
      })

      const out = yield* renderManifest({ manifest: dep, ctx })
      expect(out.spec?.template.metadata?.labels).toEqual({ app: "api", version: "v1" })
    }))
})

layer(NodeServices.layer)("NetworkPolicy.fromPodSet", (it) => {
  it.effect("uses the selector's labels as spec.podSelector and lowers ingress peers", () =>
    Effect.gen(function*() {
      const apiPods = Selector.make({ app: "api" })
      const dbPods = Selector.make({ app: "postgres" })

      const np = NetworkPolicy.fromPodSet({
        name: "api-ingress",
        namespace: "default",
        podSet: apiPods,
        policyTypes: ["Ingress"],
        ingress: [{ from: [{ podSet: dbPods }] }]
      })

      const out = yield* renderManifest({ manifest: np, ctx })
      expect(out.spec?.podSelector.matchLabels).toEqual({ app: "api" })
      expect(out.spec?.ingress?.[0]?.from?.[0]?.podSelector?.matchLabels).toEqual({
        app: "postgres"
      })
    }))
})
