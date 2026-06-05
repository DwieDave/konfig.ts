import { Manifest } from "@konfig.ts/core";
import { Effect } from "effect";
import type {
	Deployment as K8sDeployment,
	NetworkPolicy as K8sNetworkPolicy,
	Service as K8sService,
} from "./.generated/k8s-types";
import { NetworkPolicy, type NetworkPolicyFromPodSetInput } from "./policy";
import type { Selector } from "./selector";
import { Service, type ServiceFromPodSetInput } from "./network";
import { Deployment, type DeploymentFromPodSetInput } from "./workload";

/**
 * Umbrella authoring helper: emit a coherent Deployment + Service +
 * (optional) NetworkPolicy from a single `Selector`. Every resource
 * derives its selector from `podSet`, so the trio cannot drift.
 */
export interface DefinePodSetInput<L extends Readonly<Record<string, string>>> {
	readonly podSet: Selector<L>;
	readonly deployment: Omit<DeploymentFromPodSetInput<L>, "podSet">;
	readonly service?: Omit<ServiceFromPodSetInput<L>, "podSet">;
	readonly netPol?: Omit<NetworkPolicyFromPodSetInput<L>, "podSet">;
}

type PodSetOutput =
	| readonly [K8sDeployment, K8sService]
	| readonly [K8sDeployment, K8sService, K8sNetworkPolicy]
	| readonly [K8sDeployment, K8sNetworkPolicy]
	| readonly [K8sDeployment];

export const definePodSet = <L extends Readonly<Record<string, string>>>(
	input: DefinePodSetInput<L>,
): Manifest.Manifest<PodSetOutput> => {
	const deployment = Deployment.fromPodSet({ podSet: input.podSet, ...input.deployment });
	const service =
		input.service !== undefined
			? Service.fromPodSet({ podSet: input.podSet, ...input.service })
			: undefined;
	const netPol =
		input.netPol !== undefined
			? NetworkPolicy.fromPodSet({ podSet: input.podSet, ...input.netPol })
			: undefined;

	return Manifest.make<PodSetOutput>((ctx) =>
		Effect.gen(function* () {
			const d = yield* deployment.render(ctx);
			const s = service !== undefined ? yield* service.render(ctx) : undefined;
			const n = netPol !== undefined ? yield* netPol.render(ctx) : undefined;
			if (s !== undefined && n !== undefined)
				return [d, s, n] as readonly [K8sDeployment, K8sService, K8sNetworkPolicy];
			if (s !== undefined) return [d, s] as readonly [K8sDeployment, K8sService];
			if (n !== undefined) return [d, n] as readonly [K8sDeployment, K8sNetworkPolicy];
			return [d] as readonly [K8sDeployment];
		}),
	);
};
