import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { type AnyRenderError, brand, type Manifest, type PvcRef, RenderContext } from "@konfig.ts/core"
import { Effect } from "effect"
import * as fc from "fast-check"
import type { PodSpecInput } from "./container"
import { NetworkPolicy } from "./policy"
import type { VolumeName } from "./volume"
import { CronJob, Deployment, Job, StatefulSet } from "./workload"

const volName = (n: string) => brand<VolumeName<string>>(n)
const ctx = RenderContext.make("test")
const word = fc.string({ minLength: 1, maxLength: 6 })
const labels = fc.dictionary(word, word, { maxKeys: 3 })

const scribble = (value: unknown): void => {
  if (typeof value !== "object" || value === null) return
  Object.values(value).forEach(scribble)
  Object.keys(value).forEach((k) => Reflect.set(value, k, "MUTATED"))
}

const probe = (w: string) => ({
  httpGet: { path: "/", port: 80, httpHeaders: [{ name: w, value: w }] },
  exec: { command: [w] }
})

const podSpec = (l: Record<string, string>, w: string): PodSpecInput => ({
  nodeSelector: l,
  tolerations: [{ key: w, operator: "Exists" }],
  affinity: {
    nodeAffinity: {
      requiredDuringSchedulingIgnoredDuringExecution: {
        nodeSelectorTerms: [{ matchExpressions: [{ key: "k", operator: "In", values: Object.keys(l) }] }]
      }
    }
  },
  volumes: [
    { name: volName("a"), emptyDir: { medium: w } },
    { name: volName("b"), secret: { secretName: w } },
    { name: volName("c"), persistentVolumeClaim: { claimName: brand<PvcRef<string>>(w) } },
    { name: volName("d"), configMap: { name: w, items: [{ key: w, path: w }] } }
  ],
  containers: [{
    name: "c",
    image: "i",
    args: [w],
    resources: { limits: { cpu: w }, requests: { cpu: w } },
    securityContext: { capabilities: { drop: [w] } },
    lifecycle: { preStop: { exec: { command: [w] } } },
    env: [{ name: w, value: w }],
    ports: [{ containerPort: 80 }],
    volumeMounts: [{ name: volName("a"), mountPath: "/" }],
    readinessProbe: probe(w),
    livenessProbe: probe(w)
  }]
})

const meta = (l: Record<string, string>) => ({ name: "n", namespace: "ns", labels: l, annotations: l })
const template = (l: Record<string, string>, w: string) => ({
  metadata: { labels: l, annotations: l },
  spec: podSpec(l, w)
})

type Labels = Record<string, string>

interface Case {
  readonly input: unknown
  readonly run: Effect.Effect<unknown, AnyRenderError, Manifest.RenderServices>
}

const rendered = (input: unknown, manifest: Manifest.Manifest<unknown>): Case => ({
  input,
  run: manifest.render(ctx)
})

const cases: Record<string, (l: Labels, w: string) => Case> = {
  Deployment: (l, w) => {
    const input = {
      ...meta(l),
      selector: { matchLabels: l },
      strategy: { type: w },
      template: template(l, w)
    }
    return rendered(input, Deployment.make(input))
  },
  StatefulSet: (l, w) => {
    const input = {
      ...meta(l),
      selector: { matchLabels: l },
      serviceName: w,
      template: template(l, w),
      volumeClaimTemplates: [{ metadata: { name: w, labels: l } }]
    }
    return rendered(input, StatefulSet.make(input))
  },
  Job: (l, w) => {
    const input = { ...meta(l), template: template(l, w) }
    return rendered(input, Job.make(input))
  },
  CronJob: (l, w) => {
    const input = {
      ...meta(l),
      schedule: "* * * * *",
      jobTemplate: { metadata: { labels: l }, spec: { template: template(l, w) } }
    }
    return rendered(input, CronJob.make(input))
  },
  NetworkPolicy: (l, w) => {
    const input = {
      ...meta(l),
      spec: { podSelector: { matchLabels: l }, ingress: [{ ports: [{ port: 80, protocol: w }] }] }
    }
    return rendered(input, NetworkPolicy.make(input))
  }
}

const noAlias = (build: (l: Labels, w: string) => Case) =>
  fc.asyncProperty(labels, word, async (l, w) => {
    const { input, run } = build(l, w)
    const before = JSON.stringify(input)
    scribble(await Effect.runPromise(run.pipe(Effect.scoped, Effect.provide(NodeServices.layer))))
    return JSON.stringify(input) === before
  })

Object.entries(cases).forEach(([name, build]) => {
  it(`${name}.make output never aliases its input`, () => fc.assert(noAlias(build)))
})
