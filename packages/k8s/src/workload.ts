import { Manifest } from "@konfig.ts/core"
import type { Deployment as K8sDeployment, DeploymentStrategy } from "./.generated/k8s-types"
import { _lowerPodTemplate, type PodTemplateInput } from "./_lower"
import type { NamespacedMetaInput, StringMap } from "./meta"
import { toObjectMeta } from "./meta"
import type { Selector } from "./selector"

export interface DeploymentInput extends NamespacedMetaInput {
  readonly selector: { readonly matchLabels: StringMap }
  readonly template: PodTemplateInput
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
