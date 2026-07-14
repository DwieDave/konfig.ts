import type { Manifest, SecretRef } from "@konfig.ts/core"
import { Manifest as M, unsafeCoerce } from "@konfig.ts/core"
import { Effect } from "effect"
import type {
  CronJob as K8sCronJob,
  Deployment as K8sDeployment,
  Ingress as K8sIngress,
  IngressRule as K8sIngressRule,
  Service as K8sService,
  ServiceAccount as K8sServiceAccount,
  ServicePort as K8sServicePort
} from "./.generated/k8s-types"
import type { ContainerInput, ContainerSpec } from "./container"
import { Ingress, type IngressTLSInput, Service } from "./network"
import type { ServicePortSpec } from "./ports"
import type { Volume } from "./volume"
import { CronJob, Deployment } from "./workload"

/**
 * Union of port names declared by every `ContainerSpec` in `Cs`. Raw
 * `ContainerInput` entries (no `Container.define`) contribute `never`,
 * so untyped containers don't widen the result — they just don't add
 * any named-port options to the Service. With every container untyped,
 * the union collapses to `never` and `targetPort` is effectively
 * `number`-only, matching Kubernetes' behaviour when no port is named.
 */
type _PortNamesOfContainers<Cs extends ReadonlyArray<ContainerInput>> = {
  readonly [K in keyof Cs]: Cs[K] extends ContainerSpec<infer P, string> ? P : never
}[number]

/**
 * Reloader integration shorthand. Two complementary rotation models:
 *
 *  - *Build-time* rotation (re-render → new hash → rolling update). konfig
 *    does NOT stamp this automatically; it ships `hashSecretValues` as a
 *    helper you attach yourself — feed it your resolved secret values and
 *    place the digest into `deployment.podAnnotations`, so a value change
 *    flips the pod template and triggers a rollout.
 *  - *Runtime* rotation via Stakater's Reloader (operator watches mounted
 *    Secrets/ConfigMaps and patches the workload to restart pods on change),
 *    selected by the option below.
 *
 * Pick:
 *
 *  - `"off"` (default) — no Reloader annotation. Pair with a build-time
 *    `hashSecretValues` annotation if you accept the redeploy-on-edit model.
 *  - `"stakater"` — emit `reloader.stakater.com/auto: "true"`. Reloader
 *    watches every Secret/ConfigMap referenced by the pod spec.
 *  - `"stakater-strict"` — emit `reloader.stakater.com/auto: "true"`
 *    plus `reloader.stakater.com/match: "true"`, restricting watch
 *    to objects with the matching annotation set on them.
 *  - `{ secrets, configMaps }` — explicit per-resource lists, emitted
 *    as `secret.reloader.stakater.com/reload` /
 *    `configmap.reloader.stakater.com/reload` (comma-joined).
 *
 * See packages/k8s/README.md for the trade-off between build-time
 * hashes and runtime reloader.
 */
export type ReloaderOption =
  | "off"
  | "stakater"
  | "stakater-strict"
  | {
    readonly secrets?: ReadonlyArray<string>
    readonly configMaps?: ReadonlyArray<string>
  }

const _reloaderAnnotations = (
  opt: ReloaderOption | undefined
): Readonly<Record<string, string>> => {
  if (opt === undefined || opt === "off") return {}
  if (opt === "stakater") return { "reloader.stakater.com/auto": "true" }
  if (opt === "stakater-strict") {
    return {
      "reloader.stakater.com/auto": "true",
      "reloader.stakater.com/match": "true"
    }
  }
  const out: Record<string, string> = {}
  if (opt.secrets && opt.secrets.length > 0) {
    out["secret.reloader.stakater.com/reload"] = opt.secrets.join(",")
  }
  if (opt.configMaps && opt.configMaps.length > 0) {
    out["configmap.reloader.stakater.com/reload"] = opt.configMaps.join(",")
  }
  return out
}

interface WebInput<Cs extends ReadonlyArray<ContainerInput>> {
  readonly name: string
  readonly namespace: string
  readonly labels?: Readonly<Record<string, string>>
  readonly annotations?: Readonly<Record<string, string>>
  /** Pod-restart-on-rotation integration. See `ReloaderOption`. */
  readonly reloader?: ReloaderOption
  readonly deployment: {
    readonly replicas?: number
    readonly containers: Cs
    readonly volumes?: ReadonlyArray<Volume>
    readonly imagePullSecrets?: ReadonlyArray<{ readonly name: SecretRef<string> }>
    readonly serviceAccountName?: string
    readonly podLabels?: Readonly<Record<string, string>>
    readonly podAnnotations?: Readonly<Record<string, string>>
  }
  readonly service: {
    readonly ports: ReadonlyArray<ServicePortSpec<NoInfer<_PortNamesOfContainers<Cs>>>>
    readonly type?: "ClusterIP" | "NodePort" | "LoadBalancer"
  }
  readonly ingress?: {
    readonly ingressClassName?: string
    readonly rules?: ReadonlyArray<K8sIngressRule>
    readonly tls?: ReadonlyArray<IngressTLSInput>
    readonly annotations?: Readonly<Record<string, string>>
  }
}

interface _WebPartInput<Cs extends ReadonlyArray<ContainerInput>> {
  readonly input: WebInput<Cs>
  readonly selectorLabels: Readonly<Record<string, string>>
}

const _webDeployment = <Cs extends ReadonlyArray<ContainerInput>>(
  { input, selectorLabels }: _WebPartInput<Cs>
): Manifest.Manifest<K8sDeployment> => {
  // selectorLabels are spread LAST so a colliding user pod label can never
  // override the `app` selector — that would desync the pod template from
  // `spec.selector` and leave the Service with zero endpoints.
  const podLabels = { ...input.deployment.podLabels, ...selectorLabels }
  const reloaderAnns = _reloaderAnnotations(input.reloader)
  return Deployment.make({
    name: input.name,
    namespace: input.namespace,
    labels: { ...selectorLabels, ...input.labels },
    annotations: { ...input.annotations, ...reloaderAnns },
    replicas: input.deployment.replicas,
    selector: { matchLabels: selectorLabels },
    template: {
      metadata: { labels: podLabels, annotations: input.deployment.podAnnotations },
      spec: {
        containers: input.deployment.containers,
        volumes: input.deployment.volumes,
        imagePullSecrets: input.deployment.imagePullSecrets,
        serviceAccountName: input.deployment.serviceAccountName
      }
    }
  })
}

const _webService = <Cs extends ReadonlyArray<ContainerInput>>(
  { input, selectorLabels }: _WebPartInput<Cs>
): Manifest.Manifest<K8sService> =>
  Service.make({
    name: input.name,
    namespace: input.namespace,
    labels: { ...selectorLabels, ...input.labels },
    annotations: input.annotations,
    selector: selectorLabels,
    type: input.service.type ?? "ClusterIP",
    ports: unsafeCoerce<ReadonlyArray<K8sServicePort>>(
      input.service.ports,
      "ServicePortSpec<Ports> structurally matches K8sServicePort; the PortName<Ports> brand on targetPort is a phantom whose runtime value is the underlying string"
    )
  })

const _webIngress = <Cs extends ReadonlyArray<ContainerInput>>(
  { ingress, input, selectorLabels }: _WebPartInput<Cs> & { readonly ingress: NonNullable<WebInput<Cs>["ingress"]> }
): Manifest.Manifest<K8sIngress> =>
  Ingress.make({
    name: input.name,
    namespace: input.namespace,
    labels: { ...selectorLabels, ...input.labels },
    annotations: { ...input.annotations, ...ingress.annotations },
    ingressClassName: ingress.ingressClassName,
    rules: ingress.rules,
    tls: ingress.tls
  })

export const web = <const Cs extends ReadonlyArray<ContainerInput>>(
  input: WebInput<Cs>
): Manifest.Manifest<
  readonly [K8sDeployment, K8sService] | readonly [K8sDeployment, K8sService, K8sIngress]
> => {
  const selectorLabels = { app: input.name }
  const deployment = _webDeployment({ input, selectorLabels })
  const service = _webService({ input, selectorLabels })

  if (input.ingress === undefined) {
    return M.make((ctx) => Effect.all([deployment.render(ctx), service.render(ctx)], { concurrency: "unbounded" }))
  }

  const ingress = _webIngress({ input, selectorLabels, ingress: input.ingress })
  return M.make((ctx) =>
    Effect.all([deployment.render(ctx), service.render(ctx), ingress.render(ctx)], {
      concurrency: "unbounded"
    })
  )
}

interface CronInput {
  readonly name: string
  readonly namespace: string
  readonly schedule: string
  readonly labels?: Readonly<Record<string, string>>
  readonly annotations?: Readonly<Record<string, string>>
  readonly concurrencyPolicy?: "Allow" | "Forbid" | "Replace"
  readonly successfulJobsHistoryLimit?: number
  readonly failedJobsHistoryLimit?: number
  readonly containers: ReadonlyArray<ContainerInput>
  readonly volumes?: ReadonlyArray<Volume>
  readonly imagePullSecrets?: ReadonlyArray<{ readonly name: SecretRef<string> }>
  readonly restartPolicy?: "OnFailure" | "Never"
}

export const cron = (
  input: CronInput
): Manifest.Manifest<readonly [K8sServiceAccount, K8sCronJob]> => {
  const selectorLabels = { app: input.name }

  const sa: Manifest.Manifest<K8sServiceAccount> = M.make<K8sServiceAccount>(() =>
    Effect.succeed({
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: {
        name: input.name,
        namespace: input.namespace,
        labels: { ...selectorLabels, ...input.labels },
        annotations: input.annotations
      }
    })
  )

  const cronJob = CronJob.make({
    name: input.name,
    namespace: input.namespace,
    labels: { ...selectorLabels, ...input.labels },
    annotations: input.annotations,
    schedule: input.schedule,
    concurrencyPolicy: input.concurrencyPolicy,
    successfulJobsHistoryLimit: input.successfulJobsHistoryLimit,
    failedJobsHistoryLimit: input.failedJobsHistoryLimit,
    jobTemplate: {
      spec: {
        template: {
          metadata: { labels: selectorLabels },
          spec: {
            containers: input.containers,
            volumes: input.volumes,
            imagePullSecrets: input.imagePullSecrets,
            serviceAccountName: input.name,
            restartPolicy: input.restartPolicy ?? "OnFailure"
          }
        }
      }
    }
  })

  return M.make((ctx) => Effect.all([sa.render(ctx), cronJob.render(ctx)], { concurrency: "unbounded" }))
}
