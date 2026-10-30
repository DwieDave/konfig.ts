import { Manifest } from "@konfig.ts/core"
import type {
  Deployment as K8sDeployment,
  NetworkPolicy as K8sNetworkPolicy,
  Service as K8sService
} from "./.generated/k8s-types"
import type { StringMap } from "./meta"
import { Service, type ServiceFromPodSetInput } from "./network"
import { NetworkPolicy, type NetworkPolicyFromPodSetInput } from "./policy"
import type { Selector } from "./selector"
import { Deployment, type DeploymentFromPodSetInput } from "./workload"

export interface DefinePodSetInput<L extends StringMap> {
  readonly podSet: Selector<L>
  readonly deployment: Omit<DeploymentFromPodSetInput<L>, "podSet">
  readonly service?: Omit<ServiceFromPodSetInput<L>, "podSet">
  readonly netPol?: Omit<NetworkPolicyFromPodSetInput<L>, "podSet">
}

type PodSetOutput = K8sDeployment | K8sService | K8sNetworkPolicy

export const PodSet = {
  define: <L extends StringMap>(input: DefinePodSetInput<L>): Manifest.Manifest<Array<PodSetOutput>> => {
    const { podSet, service, netPol } = input

    return Manifest.concat<PodSetOutput>(
      Deployment.fromPodSet({ ...input.deployment, podSet }),
      ...(service === undefined ? [] : [Service.fromPodSet({ ...service, podSet })]),
      ...(netPol === undefined ? [] : [NetworkPolicy.fromPodSet({ ...netPol, podSet })])
    )
  }
}
