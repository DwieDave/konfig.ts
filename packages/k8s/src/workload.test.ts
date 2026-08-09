import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { describe, expect } from "vitest"
import type {
  CronJob as K8sCronJob,
  Deployment as K8sDeployment,
  Job as K8sJob,
  StatefulSet as K8sStatefulSet
} from "./.generated/k8s-types"
import { Selector } from "./selector"
import { CronJob, Deployment, Job, StatefulSet } from "./workload"

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
          metadata: { labels: { app: "not-api", tier: "web" } },
          spec: { containers: [{ name: "app", image: "nginx" }] }
        }
      })
      const res = coerce<K8sDeployment>(yield* dep.render(ctx))
      expect(res.spec?.template.metadata?.labels).toEqual({ app: "api", tier: "web" })
      expect(res.spec?.selector.matchLabels).toEqual({ app: "api" })
      expect(res.spec?.selector.matchLabels).toBeDefined()
      expect(res.spec?.template.metadata?.labels?.app).toBe(
        res.spec?.selector.matchLabels?.app
      )
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("StatefulSet.make", () => {
  it.effect("renders serviceName, volumeClaimTemplates and updateStrategy", () =>
    Effect.gen(function*() {
      const sts = StatefulSet.make({
        name: "db",
        namespace: "prod",
        serviceName: "db-headless",
        selector: { matchLabels: { app: "db" } },
        template: {
          metadata: { labels: { app: "db" } },
          spec: { containers: [{ name: "db", image: "postgres" }] }
        },
        volumeClaimTemplates: [
          {
            metadata: { name: "data" },
            spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: "10Gi" } } }
          }
        ],
        updateStrategy: { type: "RollingUpdate", rollingUpdate: { partition: 1 } }
      })
      const res = coerce<K8sStatefulSet>(yield* sts.render(ctx))
      expect(res.spec?.serviceName).toBe("db-headless")
      expect(res.spec?.volumeClaimTemplates).toEqual([
        {
          metadata: { name: "data" },
          spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: "10Gi" } } }
        }
      ])
      expect(res.spec?.updateStrategy).toEqual({ type: "RollingUpdate", rollingUpdate: { partition: 1 } })
      expect(res.spec?.template.spec?.containers[0]?.image).toBe("postgres")
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("Job.make", () => {
  it.effect("renders parallelism, completions and backoffLimit", () =>
    Effect.gen(function*() {
      const job = Job.make({
        name: "migrate",
        namespace: "prod",
        parallelism: 2,
        completions: 4,
        backoffLimit: 3,
        template: { spec: { containers: [{ name: "migrate", image: "migrator" }] } }
      })
      const res = coerce<K8sJob>(yield* job.render(ctx))
      expect(res.spec?.parallelism).toBe(2)
      expect(res.spec?.completions).toBe(4)
      expect(res.spec?.backoffLimit).toBe(3)
      expect(res.spec?.template.spec?.containers[0]?.image).toBe("migrator")
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("CronJob.make", () => {
  it.effect("renders schedule and the nested job template", () =>
    Effect.gen(function*() {
      const cron = CronJob.make({
        name: "nightly",
        namespace: "prod",
        schedule: "0 0 * * *",
        jobTemplate: {
          spec: {
            template: { spec: { containers: [{ name: "job", image: "runner" }] } },
            backoffLimit: 1
          }
        }
      })
      const res = coerce<K8sCronJob>(yield* cron.render(ctx))
      expect(res.spec?.schedule).toBe("0 0 * * *")
      expect(res.spec?.jobTemplate.spec?.backoffLimit).toBe(1)
      expect(res.spec?.jobTemplate.spec?.template.spec?.containers[0]?.image).toBe("runner")
    }).pipe(Effect.provide(NodeServices.layer)))
})
