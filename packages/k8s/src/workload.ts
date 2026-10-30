import { Manifest } from "@konfig.ts/core"
import { Effect } from "effect"
import type {
  CronJob as K8sCronJob,
  Deployment as K8sDeployment,
  DeploymentStrategy,
  Job as K8sJob,
  PersistentVolumeClaim as K8sPersistentVolumeClaim,
  StatefulSet as K8sStatefulSet,
  StatefulSetUpdateStrategy
} from "./.generated/k8s-types"
import { _lowerPodTemplate } from "./_lower"
import type { PodSpecInput } from "./container"
import { type NamespacedMetaInput, type PodTemplateMetaInput, toLabelsMeta, toObjectMeta } from "./meta"
import type { Selector } from "./selector"

interface PodTemplateShape {
  readonly metadata?: PodTemplateMetaInput
  readonly spec: PodSpecInput
}

interface SelectorAndTemplate {
  readonly selector: { readonly matchLabels: Readonly<Record<string, string>> }
  readonly template: PodTemplateShape
}

export interface DeploymentInput extends NamespacedMetaInput, SelectorAndTemplate {
  readonly replicas?: number
  readonly strategy?: DeploymentStrategy
  readonly revisionHistoryLimit?: number
  readonly progressDeadlineSeconds?: number
  readonly minReadySeconds?: number
}

export interface DeploymentFromPodSetInput<L extends Readonly<Record<string, string>>>
  extends Omit<DeploymentInput, "selector">
{
  readonly podSet: Selector<L>
}

export const Deployment = {
  make: (input: DeploymentInput): Manifest.Manifest<K8sDeployment> => {
    const resource: K8sDeployment = {
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
    }
    return Manifest.make<K8sDeployment>(() => Effect.succeed(resource))
  },
  fromPodSet: <L extends Readonly<Record<string, string>>>(
    input: DeploymentFromPodSetInput<L>
  ): Manifest.Manifest<K8sDeployment> =>
    Deployment.make({
      name: input.name,
      namespace: input.namespace,
      labels: input.labels,
      annotations: input.annotations,
      replicas: input.replicas,
      selector: { matchLabels: input.podSet.labels },
      template: {
        metadata: {
          // podSet labels spread LAST so a colliding template label can't desync spec.selector (zero endpoints).
          labels: { ...input.template.metadata?.labels, ...input.podSet.labels },
          annotations: input.template.metadata?.annotations
        },
        spec: input.template.spec
      },
      strategy: structuredClone(input.strategy),
      revisionHistoryLimit: input.revisionHistoryLimit,
      progressDeadlineSeconds: input.progressDeadlineSeconds,
      minReadySeconds: input.minReadySeconds
    })
}

export interface StatefulSetInput extends NamespacedMetaInput, SelectorAndTemplate {
  readonly replicas?: number
  readonly serviceName: string
  readonly volumeClaimTemplates?: ReadonlyArray<K8sPersistentVolumeClaim>
  readonly podManagementPolicy?: string
  readonly updateStrategy?: StatefulSetUpdateStrategy
}

export const StatefulSet = {
  make: (input: StatefulSetInput): Manifest.Manifest<K8sStatefulSet> => {
    const resource: K8sStatefulSet = {
      apiVersion: "apps/v1",
      kind: "StatefulSet",
      metadata: toObjectMeta(input),
      spec: {
        replicas: input.replicas,
        selector: structuredClone(input.selector),
        template: _lowerPodTemplate(input.template),
        serviceName: input.serviceName,
        volumeClaimTemplates: input.volumeClaimTemplates
          ? structuredClone([...input.volumeClaimTemplates])
          : undefined,
        podManagementPolicy: input.podManagementPolicy,
        updateStrategy: structuredClone(input.updateStrategy)
      }
    }
    return Manifest.make<K8sStatefulSet>(() => Effect.succeed(resource))
  }
}

export interface JobInput extends NamespacedMetaInput {
  readonly parallelism?: number
  readonly completions?: number
  readonly backoffLimit?: number
  readonly activeDeadlineSeconds?: number
  readonly ttlSecondsAfterFinished?: number
  readonly suspend?: boolean
  readonly template: PodTemplateShape
}

export const Job = {
  make: (input: JobInput): Manifest.Manifest<K8sJob> => {
    const resource: K8sJob = {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: toObjectMeta(input),
      spec: {
        parallelism: input.parallelism,
        completions: input.completions,
        backoffLimit: input.backoffLimit,
        activeDeadlineSeconds: input.activeDeadlineSeconds,
        ttlSecondsAfterFinished: input.ttlSecondsAfterFinished,
        suspend: input.suspend,
        template: _lowerPodTemplate(input.template)
      }
    }
    return Manifest.make<K8sJob>(() => Effect.succeed(resource))
  }
}

export interface CronJobInput extends NamespacedMetaInput {
  readonly schedule: string
  readonly concurrencyPolicy?: string
  readonly successfulJobsHistoryLimit?: number
  readonly failedJobsHistoryLimit?: number
  readonly startingDeadlineSeconds?: number
  readonly suspend?: boolean
  readonly jobTemplate: {
    readonly metadata?: PodTemplateMetaInput
    readonly spec: {
      readonly template: PodTemplateShape
      readonly backoffLimit?: number
      readonly activeDeadlineSeconds?: number
      readonly ttlSecondsAfterFinished?: number
    }
  }
}

export const CronJob = {
  make: (input: CronJobInput): Manifest.Manifest<K8sCronJob> => {
    const resource: K8sCronJob = {
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
          spec: {
            template: _lowerPodTemplate(input.jobTemplate.spec.template),
            backoffLimit: input.jobTemplate.spec.backoffLimit,
            activeDeadlineSeconds: input.jobTemplate.spec.activeDeadlineSeconds,
            ttlSecondsAfterFinished: input.jobTemplate.spec.ttlSecondsAfterFinished
          }
        }
      }
    }
    return Manifest.make<K8sCronJob>(() => Effect.succeed(resource))
  }
}
