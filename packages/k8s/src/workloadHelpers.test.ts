import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { describe, expect } from "vitest"
import type { Deployment as K8sDeployment } from "./.generated/k8s-types"
import { web } from "./workloadHelpers"

const coerce = <T>(value: unknown): T => value as T

const ctx = { env: "prod" } as const

describe("Workload.web pod labels", () => {
  it.effect("a colliding user pod label cannot shadow the app selector label", () =>
    Effect.gen(function*() {
      const manifest = web({
        name: "api",
        namespace: "prod",
        deployment: {
          containers: [{ name: "app", image: "nginx" }],
          // Attempt to override the `app` selector label — must NOT win.
          podLabels: { app: "not-api", tier: "web" }
        },
        service: { ports: [{ port: 80, targetPort: 80 }] }
      })
      const [deployment] = yield* manifest.render(ctx)
      const dep = coerce<K8sDeployment>(deployment)
      expect(dep.spec?.selector.matchLabels).toEqual({ app: "api" })
      expect(dep.spec?.template.metadata?.labels).toEqual({ app: "api", tier: "web" })
      expect(dep.spec?.template.metadata?.labels?.app).toBe(
        dep.spec?.selector.matchLabels.app
      )
    }).pipe(Effect.provide(NodeServices.layer)))
})
