import { Manifest, unsafeCoerce } from "@konfig.ts/core"
import { Effect } from "effect"
import type {
  Deployment as K8sDeployment,
  NetworkPolicy as K8sNetworkPolicy,
  Service as K8sService
} from "./.generated/k8s-types"
import { Service, type ServiceFromPodSetInput } from "./network"
import { NetworkPolicy, type NetworkPolicyFromPodSetInput } from "./policy"
import type { Selector } from "./selector"
import { Deployment, type DeploymentFromPodSetInput } from "./workload"

/**
 * `PodSet.define` input. Drives a coherent Deployment + Service +
 * (optional) NetworkPolicy from a single `Selector` — every resource
 * derives its selector from `podSet`, so the trio cannot drift.
 */
export interface DefinePodSetInput<L extends Readonly<Record<string, string>>> {
  readonly podSet: Selector<L>
  readonly deployment: Omit<DeploymentFromPodSetInput<L>, "podSet">
  readonly service?: Omit<ServiceFromPodSetInput<L>, "podSet">
  readonly netPol?: Omit<NetworkPolicyFromPodSetInput<L>, "podSet">
}

type PodSetOutput =
  | readonly [K8sDeployment, K8sService]
  | readonly [K8sDeployment, K8sService, K8sNetworkPolicy]
  | readonly [K8sDeployment, K8sNetworkPolicy]
  | readonly [K8sDeployment]

/**
 * `PodSet` value namespace.
 *
 *   const trio = PodSet.define({
 *     podSet: redisCachePods,
 *     deployment: { ... },
 *     service: { ... },
 *     netPol: { ... },
 *   });
 *
 * Umbrella over `Deployment.fromPodSet`, `Service.fromPodSet`, and
 * `NetworkPolicy.fromPodSet` — emits whichever subset of the trio the
 * input specifies, all rooted at one `Selector`.
 */
export const PodSet = {
  define: <L extends Readonly<Record<string, string>>>(
    input: DefinePodSetInput<L>
  ): Manifest.Manifest<PodSetOutput> => {
    const deployment = Deployment.fromPodSet({ podSet: input.podSet, ...input.deployment })
    const service = input.service !== undefined
      ? Service.fromPodSet({ podSet: input.podSet, ...input.service })
      : undefined
    const netPol = input.netPol !== undefined
      ? NetworkPolicy.fromPodSet({ podSet: input.podSet, ...input.netPol })
      : undefined

    return Manifest.make<PodSetOutput>((ctx) =>
      Effect.gen(function*() {
        const d = yield* deployment.render(ctx)
        const s = service !== undefined ? yield* service.render(ctx) : undefined
        const n = netPol !== undefined ? yield* netPol.render(ctx) : undefined
        const reason =
          "tuple element types are statically known per branch; the array literal is widened by TS, the brand-free runtime shape matches the typed tuple"
        if (s !== undefined && n !== undefined) {
          return unsafeCoerce<readonly [K8sDeployment, K8sService, K8sNetworkPolicy]>([d, s, n], reason)
        }
        if (s !== undefined) return unsafeCoerce<readonly [K8sDeployment, K8sService]>([d, s], reason)
        if (n !== undefined) return unsafeCoerce<readonly [K8sDeployment, K8sNetworkPolicy]>([d, n], reason)
        return unsafeCoerce<readonly [K8sDeployment]>([d], reason)
      })
    )
  }
}
