import { Manifest, type SecretRef } from "@konfig.ts/core"
import type {
  CronJob as K8sCronJob,
  Deployment as K8sDeployment,
  Ingress as K8sIngress,
  IngressRule as K8sIngressRule,
  Service as K8sService,
  ServiceAccount as K8sServiceAccount
} from "./.generated/k8s-types"
import type { PodTemplateInput } from "./_lower"
import type { ContainerInput, ContainerSpec } from "./container"
import { ServiceAccount, type ServiceAccountManifest } from "./identity"
import { nonEmpty, type StringMap } from "./meta"
import { Ingress, type IngressTLSInput, Service } from "./network"
import type { ServicePortSpec } from "./ports"
import { _reloaderAnnotations, type ReloaderOption } from "./reloader"
import type { Volume } from "./volume"
import { CronJob, Deployment } from "./workload"

export type { ReloaderOption }

type _PortNamesOfContainers<Cs extends ReadonlyArray<ContainerInput>> = {
  readonly [K in keyof Cs]: Cs[K] extends ContainerSpec<infer P, string> ? P : never
}[number]

interface WebInput<Cs extends ReadonlyArray<ContainerInput>> {
  readonly name: string
  readonly namespace: string
  readonly labels?: StringMap
  readonly annotations?: StringMap
  readonly reloader?: ReloaderOption
  readonly deployment: {
    readonly replicas?: number
    readonly containers: Cs
    readonly volumes?: ReadonlyArray<Volume>
    readonly imagePullSecrets?: ReadonlyArray<{ readonly name: SecretRef<string> }>
    readonly serviceAccountName?: string
    readonly podLabels?: StringMap
    readonly podAnnotations?: StringMap
  }
  readonly service: {
    readonly ports: ReadonlyArray<ServicePortSpec<NoInfer<_PortNamesOfContainers<Cs>>>>
    readonly type?: "ClusterIP" | "NodePort" | "LoadBalancer"
  }
  readonly ingress?: {
    readonly ingressClassName?: string
    readonly rules?: ReadonlyArray<K8sIngressRule>
    readonly tls?: ReadonlyArray<IngressTLSInput>
    readonly annotations?: StringMap
  }
}

interface _WebPartInput<Cs extends ReadonlyArray<ContainerInput>> {
  readonly input: WebInput<Cs>
  readonly selectorLabels: StringMap
}

const _webDeployment = <Cs extends ReadonlyArray<ContainerInput>>(
  { input, selectorLabels }: _WebPartInput<Cs>
): Manifest.Manifest<K8sDeployment> => {
  // selectorLabels spread LAST so a colliding pod label can't desync spec.selector (zero endpoints).
  const podLabels = { ...input.deployment.podLabels, ...selectorLabels }

  return Deployment.make({
    name: input.name,
    namespace: input.namespace,
    labels: { ...selectorLabels, ...input.labels },
    annotations: nonEmpty({ ...input.annotations, ..._reloaderAnnotations(input.reloader) }),
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
    annotations: nonEmpty({ ...input.annotations, ...ingress.annotations }),
    ingressClassName: ingress.ingressClassName,
    rules: ingress.rules,
    tls: ingress.tls
  })

type WebOutput = K8sDeployment | K8sService | K8sIngress

export const web = <const Cs extends ReadonlyArray<ContainerInput>>(
  input: WebInput<Cs>
): Manifest.Manifest<Array<WebOutput>> => {
  const selectorLabels = { app: input.name }
  const { ingress } = input

  return Manifest.concat<WebOutput>(
    _webDeployment({ input, selectorLabels }),
    _webService({ input, selectorLabels }),
    ...(ingress === undefined ? [] : [_webIngress({ input, selectorLabels, ingress })])
  )
}

interface CronInput {
  readonly name: string
  readonly namespace: string
  readonly schedule: string
  readonly labels?: StringMap
  readonly annotations?: StringMap
  readonly concurrencyPolicy?: "Allow" | "Forbid" | "Replace"
  readonly successfulJobsHistoryLimit?: number
  readonly failedJobsHistoryLimit?: number
  readonly containers: ReadonlyArray<ContainerInput>
  readonly volumes?: ReadonlyArray<Volume>
  readonly imagePullSecrets?: ReadonlyArray<{ readonly name: SecretRef<string> }>
  readonly restartPolicy?: "OnFailure" | "Never"
}

interface _CronPartInput {
  readonly input: CronInput
  readonly selectorLabels: StringMap
}

const _cronServiceAccount = ({ input, selectorLabels }: _CronPartInput): ServiceAccountManifest<string> =>
  ServiceAccount.make({
    name: input.name,
    namespace: input.namespace,
    labels: { ...selectorLabels, ...input.labels },
    annotations: input.annotations
  })

interface _CronJobPartInput extends _CronPartInput {
  readonly serviceAccountName: string
}

const _cronPodTemplate = ({ input, selectorLabels, serviceAccountName }: _CronJobPartInput): PodTemplateInput => ({
  metadata: { labels: selectorLabels },
  spec: {
    containers: input.containers,
    volumes: input.volumes,
    imagePullSecrets: input.imagePullSecrets,
    serviceAccountName,
    restartPolicy: input.restartPolicy ?? "OnFailure"
  }
})

const _cronJob = (part: _CronJobPartInput): Manifest.Manifest<K8sCronJob> =>
  CronJob.make({
    name: part.input.name,
    namespace: part.input.namespace,
    labels: { ...part.selectorLabels, ...part.input.labels },
    annotations: part.input.annotations,
    schedule: part.input.schedule,
    concurrencyPolicy: part.input.concurrencyPolicy,
    successfulJobsHistoryLimit: part.input.successfulJobsHistoryLimit,
    failedJobsHistoryLimit: part.input.failedJobsHistoryLimit,
    jobTemplate: { spec: { template: _cronPodTemplate(part) } }
  })

type CronOutput = K8sServiceAccount | K8sCronJob

export const cron = (input: CronInput): Manifest.Manifest<Array<CronOutput>> => {
  const selectorLabels = { app: input.name }
  const serviceAccount = _cronServiceAccount({ input, selectorLabels })

  return Manifest.concat<CronOutput>(
    serviceAccount,
    _cronJob({ input, selectorLabels, serviceAccountName: serviceAccount.ref })
  )
}
