import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { describe, expect } from "vitest"
import type { Deployment as K8sDeployment } from "./.generated/k8s-types"
import { Selector } from "./selector"
import { Deployment } from "./workload"

const coerce = <T>(value: unknown): T => value as T

const ctx = { env: "prod" } as const

describe("Deployment.fromPodSet", () => {
  it.effect("selector labels and pod template labels are coherent by construction", () =>
    Effect.gen(function*() {
      const pods = Selector.make({ app: "api" })
      const dep = Deployment.fromPodSet({
        name: "api",
        namespace: "prod",
        podSet: pods,
        template: { spec: { containers: [{ name: "app", image: "nginx" }] } }
      })
      const res = coerce<K8sDeployment>(yield* dep.render(ctx))
      expect(res.spec?.selector.matchLabels).toEqual({ app: "api" })
      expect(res.spec?.template.metadata?.labels).toEqual({ app: "api" })
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("a colliding template label cannot shadow the selector label", () =>
    Effect.gen(function*() {
      const pods = Selector.make({ app: "api" })
      const dep = Deployment.fromPodSet({
        name: "api",
        namespace: "prod",
        podSet: pods,
        template: {
          // Malicious/accidental override of the selector key — must NOT win.
          metadata: { labels: { app: "not-api", tier: "web" } },
          spec: { containers: [{ name: "app", image: "nginx" }] }
        }
      })
      const res = coerce<K8sDeployment>(yield* dep.render(ctx))
      // selector label survives; the extra label is still merged in.
      expect(res.spec?.template.metadata?.labels).toEqual({ app: "api", tier: "web" })
      expect(res.spec?.selector.matchLabels).toEqual({ app: "api" })
      expect(res.spec?.template.metadata?.labels?.app).toBe(
        res.spec?.selector.matchLabels.app
      )
    }).pipe(Effect.provide(NodeServices.layer)))
})
