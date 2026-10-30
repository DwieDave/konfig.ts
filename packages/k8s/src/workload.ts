import { Manifest } from "@konfig.ts/core"
import type {
  CronJob as K8sCronJob,
  Deployment as K8sDeployment,
  DeploymentStrategy,
  Job as K8sJob,
  PersistentVolumeClaim as K8sPersistentVolumeClaim,
  StatefulSet as K8sStatefulSet,
  StatefulSetUpdateStrategy
} from "./.generated/k8s-types"
import { _lowerPodTemplate, type PodTemplateInput } from "./_lower"
import type { MetaLabels, NamespacedMetaInput, StringMap } from "./meta"
import { cloneList, toLabelsMeta, toObjectMeta } from "./meta"
import type { Selector } from "./selector"

interface SelectedPodsInput extends NamespacedMetaInput {
  readonly selector: { readonly matchLabels: StringMap }
  readonly template: PodTemplateInput
}

export interface DeploymentInput extends SelectedPodsInput {
  readonly replicas?: number
  readonly strategy?: DeploymentStrategy
  readonly revisionHistoryLimit?: number
  readonly progressDeadlineSeconds?: number
  readonly minReadySeconds?: number
}

export interface DeploymentFromPodSetInput<L extends StringMap> extends Omit<DeploymentInput, "selector"> {
  readonly podSet: Selector<L>
}

const _buildDeployment = (input: DeploymentInput): K8sDeployment => ({
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: toObjectMeta(input),
  spec: {
    replicas: input.replicas,
    selector: structuredClone(input.selector),
    template: _lowerPodTemplate(input.template),
    strategy: structuredClone(input.strategy),
    revisionHistoryLimit: input.revisionHistoryLimit,
    progressDeadlineSeconds: input.progressDeadlineSeconds,
    minReadySeconds: input.minReadySeconds
  }
})

const _fromPodSetInput = <L extends StringMap>(input: DeploymentFromPodSetInput<L>): DeploymentInput => ({
  ...input,
  selector: { matchLabels: input.podSet.labels },
  template: {
    metadata: {
      // podSet labels spread LAST so a colliding template label can't desync spec.selector (zero endpoints).
      labels: { ...input.template.metadata?.labels, ...input.podSet.labels },
      annotations: input.template.metadata?.annotations
    },
    spec: input.template.spec
  }
})

export const Deployment = {
  make: (input: DeploymentInput): Manifest.Manifest<K8sDeployment> => Manifest.make(() => _buildDeployment(input)),
  fromPodSet: <L extends StringMap>(input: DeploymentFromPodSetInput<L>): Manifest.Manifest<K8sDeployment> =>
    Deployment.make(_fromPodSetInput(input))
}

export interface StatefulSetInput extends SelectedPodsInput {
  readonly serviceName: string
  readonly replicas?: number
  readonly volumeClaimTemplates?: ReadonlyArray<K8sPersistentVolumeClaim>
  readonly podManagementPolicy?: string
  readonly updateStrategy?: StatefulSetUpdateStrategy
}

const _buildStatefulSet = (input: StatefulSetInput): K8sStatefulSet => ({
  apiVersion: "apps/v1",
  kind: "StatefulSet",
  metadata: toObjectMeta(input),
  spec: {
    replicas: input.replicas,
    selector: structuredClone(input.selector),
    template: _lowerPodTemplate(input.template),
    serviceName: input.serviceName,
    volumeClaimTemplates: cloneList(input.volumeClaimTemplates),
    podManagementPolicy: input.podManagementPolicy,
    updateStrategy: structuredClone(input.updateStrategy)
  }
})

export const StatefulSet = {
  make: (input: StatefulSetInput): Manifest.Manifest<K8sStatefulSet> => Manifest.make(() => _buildStatefulSet(input))
}

interface JobSpecInput {
  readonly template: PodTemplateInput
  readonly backoffLimit?: number
  readonly activeDeadlineSeconds?: number
  readonly ttlSecondsAfterFinished?: number
}

export interface JobInput extends NamespacedMetaInput, JobSpecInput {
  readonly parallelism?: number
  readonly completions?: number
  readonly suspend?: boolean
}

const _lowerJobSpec = (spec: JobSpecInput) => ({
  template: _lowerPodTemplate(spec.template),
  backoffLimit: spec.backoffLimit,
  activeDeadlineSeconds: spec.activeDeadlineSeconds,
  ttlSecondsAfterFinished: spec.ttlSecondsAfterFinished
})

const _buildJob = (input: JobInput): K8sJob => ({
  apiVersion: "batch/v1",
  kind: "Job",
  metadata: toObjectMeta(input),
  spec: {
    ..._lowerJobSpec(input),
    parallelism: input.parallelism,
    completions: input.completions,
    suspend: input.suspend
  }
})

export const Job = {
  make: (input: JobInput): Manifest.Manifest<K8sJob> => Manifest.make(() => _buildJob(input))
}

export interface CronJobInput extends NamespacedMetaInput {
  readonly schedule: string
  readonly concurrencyPolicy?: string
  readonly successfulJobsHistoryLimit?: number
  readonly failedJobsHistoryLimit?: number
  readonly startingDeadlineSeconds?: number
  readonly suspend?: boolean
  readonly jobTemplate: {
    readonly metadata?: MetaLabels
    readonly spec: JobSpecInput
  }
}

const _buildCronJob = (input: CronJobInput): K8sCronJob => ({
  apiVersion: "batch/v1",
  kind: "CronJob",
  metadata: toObjectMeta(input),
  spec: {
    schedule: input.schedule,
    concurrencyPolicy: input.concurrencyPolicy,
    successfulJobsHistoryLimit: input.successfulJobsHistoryLimit,
    failedJobsHistoryLimit: input.failedJobsHistoryLimit,
    startingDeadlineSeconds: input.startingDeadlineSeconds,
    suspend: input.suspend,
    jobTemplate: {
      metadata: toLabelsMeta(input.jobTemplate.metadata),
      spec: _lowerJobSpec(input.jobTemplate.spec)
    }
  }
})

export const CronJob = {
  make: (input: CronJobInput): Manifest.Manifest<K8sCronJob> => Manifest.make(() => _buildCronJob(input))
}
