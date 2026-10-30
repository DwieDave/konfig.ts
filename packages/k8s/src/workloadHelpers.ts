import type { Manifest, SecretRef } from "@konfig.ts/core"
import { Manifest as M } from "@konfig.ts/core"
import { Effect } from "effect"
import type {
  CronJob as K8sCronJob,
  Deployment as K8sDeployment,
  Ingress as K8sIngress,
  IngressRule as K8sIngressRule,
  Service as K8sService,
  ServiceAccount as K8sServiceAccount
} from "./.generated/k8s-types"
import type { ContainerInput, ContainerSpec } from "./container"
import { ServiceAccount } from "./identity"
import { Ingress, type IngressTLSInput, Service } from "./network"
import type { ServicePortSpec } from "./ports"
import { _reloaderAnnotations, type ReloaderOption } from "./reloader"
import type { Volume } from "./volume"
import { CronJob, Deployment } from "./workload"

type _PortNamesOfContainers<Cs extends ReadonlyArray<ContainerInput>> = {
  readonly [K in keyof Cs]: Cs[K] extends ContainerSpec<infer P, string> ? P : never
}[number]

export type { ReloaderOption } from "./reloader"

interface WebInput<Cs extends ReadonlyArray<ContainerInput>> {
  readonly name: string
  readonly namespace: string
  readonly labels?: Readonly<Record<string, string>>
  readonly annotations?: Readonly<Record<string, string>>
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
  // selectorLabels spread LAST so a colliding pod label can't desync spec.selector (zero endpoints).
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
    ports: input.service.ports
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

const _cronPodSpec = (input: CronInput) => ({
  containers: input.containers,
  volumes: input.volumes,
  imagePullSecrets: input.imagePullSecrets,
  serviceAccountName: input.name,
  restartPolicy: input.restartPolicy ?? "OnFailure"
})

const _cronJob = (input: CronInput, labels: Readonly<Record<string, string>>) =>
  CronJob.make({
    name: input.name,
    namespace: input.namespace,
    labels,
    annotations: input.annotations,
    schedule: input.schedule,
    concurrencyPolicy: input.concurrencyPolicy,
    successfulJobsHistoryLimit: input.successfulJobsHistoryLimit,
    failedJobsHistoryLimit: input.failedJobsHistoryLimit,
    jobTemplate: {
      spec: { template: { metadata: { labels: { app: input.name } }, spec: _cronPodSpec(input) } }
    }
  })

export const cron = (
  input: CronInput
): Manifest.Manifest<readonly [K8sServiceAccount, K8sCronJob]> => {
  const labels = { app: input.name, ...input.labels }
  const sa = ServiceAccount.make({
    name: input.name,
    namespace: input.namespace,
    labels,
    annotations: input.annotations
  })
  const cronJob = _cronJob(input, labels)
  return M.make((ctx) => Effect.all([sa.render(ctx), cronJob.render(ctx)], { concurrency: "unbounded" }))
}
