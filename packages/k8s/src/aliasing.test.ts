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
import { ConfigMap, Namespace, Secret, ServiceAccount } from "./identity"
import { Ingress, Service } from "./network"
import { PodSet } from "./podSet"
import {
  ClusterRole,
  ClusterRoleBinding,
  NetworkPolicy,
  PersistentVolume,
  PersistentVolumeClaim,
  type PersistentVolumeClaimInput,
  type PersistentVolumeInput,
  Role,
  RoleBinding
} from "./policy"
import { Selector } from "./selector"
import type { VolumeName } from "./volume"
import { CronJob, Deployment, Job, StatefulSet } from "./workload"
import { cron } from "./workloadHelpers"

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

const rules = (w: string) => [{ apiGroups: [w], resources: [w], verbs: [w] }]

const roleRef = (w: string) => ({ apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: w })

const subjects = (w: string) => [{ kind: "ServiceAccount", name: w, namespace: w }]

const pullSecrets = (w: string) => [{ name: brand<SecretRef<string>>(w) }]

const workloads = {
  "Deployment.make": (l, w) => {
    const input = {
      ...meta(l),
      selector: { matchLabels: l },
      strategy: { type: w },
      template: template(l, w)
    }

    return rendered(input, Deployment.make(input))
  },
  "StatefulSet.make": (l, w) => {
    const input = {
      ...meta(l),
      selector: { matchLabels: l },
      serviceName: w,
      template: template(l, w),
      volumeClaimTemplates: [{ metadata: { name: w, labels: l }, spec: { accessModes: [w] } }],
      updateStrategy: { type: w, rollingUpdate: { partition: 1 } }
    }

    return rendered(input, StatefulSet.make(input))
  },
  "Job.make": (l, w) => {
    const input = { ...meta(l), template: template(l, w) }

    return rendered(input, Job.make(input))
  },
  "CronJob.make": (l, w) => {
    const input = {
      ...meta(l),
      schedule: "* * * * *",
      jobTemplate: { metadata: { labels: l, annotations: l }, spec: { template: template(l, w) } }
    }

    return rendered(input, CronJob.make(input))
  },
  "Workload.cron": (l, w) => {
    const spec = podSpec(l, w)

    const input = {
      ...meta(l),
      schedule: "* * * * *",
      containers: spec.containers,
      volumes: spec.volumes,
      imagePullSecrets: pullSecrets(w)
    }

    return rendered(input, cron(input))
  },
  "PodSet.define": (l, w) => {
    const input = {
      podSet: Selector.make(l),
      deployment: { ...meta(l), template: template(l, w) },
      service: { ...meta(l), ports: [{ port: 80, name: w }] },
      netPol: { ...meta(l), ingress: [{ from: [{ podSet: Selector.make(l) }], ports: [{ port: 80, protocol: w }] }] }
    }

    return rendered(input, PodSet.define(input))
  }
} satisfies Record<string, (l: Labels, w: string) => Case>

const networking = {
  "NetworkPolicy.make": (l, w) => {
    const input = {
      ...meta(l),
      spec: { podSelector: { matchLabels: l }, ingress: [{ ports: [{ port: 80, protocol: w }] }] }
    }

    return rendered(input, NetworkPolicy.make(input))
  },
  "Service.make": (l, w) => {
    const input = { ...meta(l), selector: l, ports: [{ port: 80, name: w }] }

    return rendered(input, Service.make(input))
  },
  "Service.fromPodSet": (l, w) => {
    const input = { ...meta(l), podSet: Selector.make(l), ports: [{ port: 80, name: w }] }

    return rendered(input, Service.fromPodSet(input))
  },
  "Ingress.make": (l, w) => {
    const input = {
      ...meta(l),
      ingressClassName: w,
      rules: [{ host: w, http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: w } } }] } }],
      tls: [{ hosts: [w], secretName: brand<SecretRef<string>>(w) }],
      defaultBackend: { service: { name: w } }
    }

    return rendered(input, Ingress.make(input))
  }
} satisfies Record<string, (l: Labels, w: string) => Case>

const identity = {
  "ConfigMap.make": (l, w) => {
    const input = { ...meta(l), data: l, binaryData: { [w]: w } }

    return rendered(input, ConfigMap.make(input))
  },
  "Secret.make": (l, w) => {
    const input = { ...meta(l), data: l, stringData: { [w]: w } }

    return rendered(input, Secret.make(input))
  },
  "Namespace.make": (l) => {
    const input = { name: "n", labels: l, annotations: l }

    return rendered(input, Namespace.make(input))
  },
  "ServiceAccount.make": (l, w) => {
    const input = { ...meta(l), automountServiceAccountToken: false, imagePullSecrets: pullSecrets(w) }

    return rendered(input, ServiceAccount.make(input))
  }
} satisfies Record<string, (l: Labels, w: string) => Case>

const storage = {
  "PersistentVolume.make": (l, w) => {
    const input: PersistentVolumeInput = {
      name: "n",
      labels: l,
      annotations: l,
      spec: {
        capacity: { storage: w },
        accessModes: ["ReadWriteOnce"],
        mountOptions: [w],
        csi: { driver: w, volumeHandle: w, volumeAttributes: l },
        claimRef: { namespace: w, name: w }
      }
    }

    return rendered(input, PersistentVolume.make(input))
  },
  "PersistentVolumeClaim.make": (l, w) => {
    const input: PersistentVolumeClaimInput = {
      ...meta(l),
      spec: {
        accessModes: ["ReadWriteOnce"],
        resources: { requests: { storage: w } },
        selector: { matchLabels: l }
      }
    }

    return rendered(input, PersistentVolumeClaim.make(input))
  }
} satisfies Record<string, (l: Labels, w: string) => Case>

const rbac = {
  "Role.make": (l, w) => {
    const input = { ...meta(l), rules: rules(w) }

    return rendered(input, Role.make(input))
  },
  "RoleBinding.make": (l, w) => {
    const input = { ...meta(l), roleRef: roleRef(w), subjects: subjects(w) }

    return rendered(input, RoleBinding.make(input))
  },
  "ClusterRole.make": (l, w) => {
    const input = {
      name: "n",
      labels: l,
      rules: rules(w),
      aggregationRule: { clusterRoleSelectors: [{ matchLabels: l }] }
    }

    return rendered(input, ClusterRole.make(input))
  },
  "ClusterRoleBinding.make": (l, w) => {
    const input = { name: "n", annotations: l, roleRef: roleRef(w), subjects: subjects(w) }

    return rendered(input, ClusterRoleBinding.make(input))
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

const cases = { ...workloads, ...networking, ...identity, ...storage, ...rbac }

Object.entries(cases).forEach(([name, build]) => {
  it(`${name} output never aliases its input`, () => fc.assert(noAlias(build)))
  it(`${name} renders are independent of earlier renders`, () => fc.assert(rendersStable(build)))
})
