import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import {
  type AnyRenderError,
  brand,
  type ConfigMapRef,
  type Manifest,
  type PvcRef,
  RenderContext,
  type SecretRef
} from "@konfig.ts/core"
import { Effect, Predicate } from "effect"
import * as fc from "fast-check"
import type { PodSpecInput } from "./container"
import { ConfigMap, Namespace, Secret } from "./identity"
import { _serviceManifest, Ingress } from "./network"
import { _policyManifest } from "./policy"
import type { VolumeName } from "./volume"
import { Deployment } from "./workload"

const volName = (n: string) => brand<VolumeName<string>>(n)
const ctx = RenderContext.make("test")
const word = fc.string({ minLength: 1, maxLength: 6 })
const labels = fc.dictionary(word, word, { maxKeys: 3 })

const scribble = <V extends object>(value: V): void => {
  Object.values(value).filter(Predicate.isObjectOrArray).forEach(scribble)
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
    { name: volName("b"), secret: { secretName: brand<SecretRef<string>>(w) } },
    { name: volName("c"), persistentVolumeClaim: { claimName: brand<PvcRef<string>>(w) } },
    { name: volName("d"), configMap: { name: brand<ConfigMapRef<string>>(w), items: [{ key: w, path: w }] } }
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
  readonly input: object
  readonly run: () => Effect.Effect<object, AnyRenderError, Manifest.RenderServices>
}

const rendered = <I extends object>(input: I, manifest: Manifest.Manifest<object>): Case => ({
  input,
  run: () => manifest.render(ctx)
})

const cases = {
  Deployment: (l, w) => {
    const input = {
      ...meta(l),
      selector: { matchLabels: l },
      strategy: { type: w },
      template: template(l, w)
    }

    return rendered(input, Deployment.make(input))
  },
  NetworkPolicy: (l, w) => {
    const input = {
      ...meta(l),
      spec: { podSelector: { matchLabels: l }, ingress: [{ ports: [{ port: 80, protocol: w }] }] }
    }

    return rendered(input, _policyManifest(input))
  },
  Service: (l, w) => {
    const input = { ...meta(l), selector: l, ports: [{ port: 80, name: w }] }

    return rendered(input, _serviceManifest(input))
  },
  Ingress: (l, w) => {
    const input = {
      ...meta(l),
      ingressClassName: w,
      rules: [{ host: w, http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: w } } }] } }],
      tls: [{ hosts: [w], secretName: brand<SecretRef<string>>(w) }],
      defaultBackend: { service: { name: w } }
    }

    return rendered(input, Ingress.make(input))
  },
  ConfigMap: (l, w) => {
    const input = { ...meta(l), data: l, binaryData: { [w]: w } }

    return rendered(input, ConfigMap.make(input))
  },
  Secret: (l, w) => {
    const input = { ...meta(l), data: l, stringData: { [w]: w } }

    return rendered(input, Secret.make(input))
  },
  Namespace: (l) => {
    const input = { name: "n", labels: l, annotations: l }

    return rendered(input, Namespace.make(input))
  }
} satisfies Record<string, (l: Labels, w: string) => Case>

const runOnce = (run: Case["run"]) => Effect.runPromise(run().pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

const noAlias = (build: (l: Labels, w: string) => Case) =>
  fc.asyncProperty(labels, word, async (l, w) => {
    const { input, run } = build(l, w)
    const before = JSON.stringify(input)
    scribble(await runOnce(run))

    return JSON.stringify(input) === before
  })

const rendersStable = (build: (l: Labels, w: string) => Case) =>
  fc.asyncProperty(labels, word, async (l, w) => {
    const { run } = build(l, w)
    const first = JSON.stringify(await runOnce(run))
    scribble(await runOnce(run))

    return JSON.stringify(await runOnce(run)) === first
  })

Object.entries(cases).forEach(([name, build]) => {
  it(`${name}.make output never aliases its input`, () => fc.assert(noAlias(build)))
  it(`${name}.make renders are independent of earlier renders`, () => fc.assert(rendersStable(build)))
})
