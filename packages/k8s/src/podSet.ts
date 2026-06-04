import { Manifest, unsafeCoerce } from "@konfig.ts/core";
import { Effect } from "effect";
import type { PodSpecInput } from "./container";
import type {
	Deployment as K8sDeployment,
	NetworkPolicy as K8sNetworkPolicy,
	Service as K8sService,
	ServicePort as K8sServicePort,
} from "./.generated/k8s-types";
import type {
	NetworkPolicyEgressRule as K8sNetworkPolicyEgressRule,
	NetworkPolicyIngressRule as K8sNetworkPolicyIngressRule,
} from "kubernetes-types/networking/v1";
import type { SelectorBundle } from "./selector";
import { Deployment } from "./workload";
import { Service } from "./network";
import { NetworkPolicy } from "./policy";

interface CommonMeta {
	readonly name: string;
	readonly namespace: string;
	readonly labels?: Readonly<Record<string, string>>;
	readonly annotations?: Readonly<Record<string, string>>;
}

/**
 * Deployment built from a SelectorBundle. The bundle's labels become
 * both the Deployment's `spec.selector.matchLabels` and the pod
 * template's `metadata.labels` — coherent by construction.
 */
export interface BundledDeploymentInput<L extends Readonly<Record<string, string>>>
	extends CommonMeta {
	readonly podSet: SelectorBundle<L>;
	readonly replicas?: number;
	readonly template: {
		readonly metadata?: {
			readonly labels?: Readonly<Record<string, string>>;
			readonly annotations?: Readonly<Record<string, string>>;
		};
		readonly spec: PodSpecInput;
	};
	readonly strategy?: unknown;
	readonly revisionHistoryLimit?: number;
	readonly progressDeadlineSeconds?: number;
	readonly minReadySeconds?: number;
}

export const bundledDeployment = <L extends Readonly<Record<string, string>>>(
	input: BundledDeploymentInput<L>,
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
				labels: { ...input.podSet.labels, ...input.template.metadata?.labels },
				annotations: input.template.metadata?.annotations,
			},
			spec: input.template.spec,
		},
		strategy: input.strategy,
		revisionHistoryLimit: input.revisionHistoryLimit,
		progressDeadlineSeconds: input.progressDeadlineSeconds,
		minReadySeconds: input.minReadySeconds,
	});

/**
 * Service built from a SelectorBundle. The bundle's labels populate
 * `spec.selector` — drift versus the bundled Deployment is impossible
 * once both consume the same `podSet`.
 */
export interface BundledServiceInput<L extends Readonly<Record<string, string>>>
	extends CommonMeta {
	readonly podSet: SelectorBundle<L>;
	readonly ports: ReadonlyArray<K8sServicePort>;
	readonly type?: "ClusterIP" | "NodePort" | "LoadBalancer";
	readonly clusterIP?: string;
	readonly sessionAffinity?: string;
	readonly publishNotReadyAddresses?: boolean;
	readonly externalTrafficPolicy?: string;
	readonly internalTrafficPolicy?: string;
}

export const bundledService = <L extends Readonly<Record<string, string>>>(
	input: BundledServiceInput<L>,
): Manifest.Manifest<K8sService> =>
	Service.make({
		name: input.name,
		namespace: input.namespace,
		labels: input.labels,
		annotations: input.annotations,
		selector: input.podSet.labels,
		ports: input.ports,
		type: input.type,
		clusterIP: input.clusterIP,
		sessionAffinity: input.sessionAffinity,
		publishNotReadyAddresses: input.publishNotReadyAddresses,
		externalTrafficPolicy: input.externalTrafficPolicy,
		internalTrafficPolicy: input.internalTrafficPolicy,
	});

/**
 * NetworkPolicy built from SelectorBundles. The owning pod set
 * (`podSet`) drives `spec.podSelector`; ingress/egress peer rules
 * accept further bundles via `from[].podSet` / `to[].podSet`. Peer
 * bundles need not match the owning bundle.
 */
export interface BundledNetworkPolicyInput<L extends Readonly<Record<string, string>>>
	extends CommonMeta {
	readonly podSet: SelectorBundle<L>;
	readonly policyTypes?: ReadonlyArray<"Ingress" | "Egress">;
	readonly ingress?: ReadonlyArray<BundledIngressRule>;
	readonly egress?: ReadonlyArray<BundledEgressRule>;
}

export interface BundledPeer {
	readonly podSet?: SelectorBundle<Readonly<Record<string, string>>>;
	readonly namespaceSelector?: { readonly matchLabels?: Readonly<Record<string, string>> };
	readonly ipBlock?: { readonly cidr: string; readonly except?: ReadonlyArray<string> };
}

export interface BundledIngressRule {
	readonly from?: ReadonlyArray<BundledPeer>;
	readonly ports?: K8sNetworkPolicyIngressRule["ports"];
}

export interface BundledEgressRule {
	readonly to?: ReadonlyArray<BundledPeer>;
	readonly ports?: K8sNetworkPolicyEgressRule["ports"];
}

const _lowerPeer = (peer: BundledPeer): {
	readonly podSelector?: { readonly matchLabels?: Readonly<Record<string, string>> };
	readonly namespaceSelector?: { readonly matchLabels?: Readonly<Record<string, string>> };
	readonly ipBlock?: { readonly cidr: string; readonly except?: ReadonlyArray<string> };
} => ({
	...(peer.podSet !== undefined ? { podSelector: { matchLabels: peer.podSet.labels } } : {}),
	...(peer.namespaceSelector !== undefined ? { namespaceSelector: peer.namespaceSelector } : {}),
	...(peer.ipBlock !== undefined ? { ipBlock: peer.ipBlock } : {}),
});

export const bundledNetworkPolicy = <L extends Readonly<Record<string, string>>>(
	input: BundledNetworkPolicyInput<L>,
): Manifest.Manifest<K8sNetworkPolicy> => {
	const ingress = input.ingress?.map((rule) => ({
		from: rule.from?.map(_lowerPeer),
		ports: rule.ports,
	}));
	const egress = input.egress?.map((rule) => ({
		to: rule.to?.map(_lowerPeer),
		ports: rule.ports,
	}));
	return NetworkPolicy.make({
		name: input.name,
		namespace: input.namespace,
		labels: input.labels,
		annotations: input.annotations,
		spec: unsafeCoerce<K8sNetworkPolicy["spec"]>(
			{
				podSelector: { matchLabels: input.podSet.labels },
				policyTypes: input.policyTypes,
				ingress,
				egress,
			},
			"konfig peers carry readonly arrays; upstream NetworkPolicySpec is mutable but the runtime shape matches",
		),
	});
};

/**
 * Umbrella helper: emit a coherent Deployment + Service + (optional)
 * NetworkPolicy from a single SelectorBundle. Every resource derives
 * its selector from `podSet`, so the trio cannot drift.
 */
export interface PodSetResourcesInput<L extends Readonly<Record<string, string>>> {
	readonly podSet: SelectorBundle<L>;
	readonly deployment: Omit<BundledDeploymentInput<L>, "podSet">;
	readonly service?: Omit<BundledServiceInput<L>, "podSet">;
	readonly netPol?: Omit<BundledNetworkPolicyInput<L>, "podSet">;
}

type PodSetResourcesOutput =
	| readonly [K8sDeployment, K8sService]
	| readonly [K8sDeployment, K8sService, K8sNetworkPolicy]
	| readonly [K8sDeployment, K8sNetworkPolicy]
	| readonly [K8sDeployment];

export const podSetResources = <L extends Readonly<Record<string, string>>>(
	input: PodSetResourcesInput<L>,
): Manifest.Manifest<PodSetResourcesOutput> => {
	const deployment = bundledDeployment({ podSet: input.podSet, ...input.deployment });
	const service =
		input.service !== undefined
			? bundledService({ podSet: input.podSet, ...input.service })
			: undefined;
	const netPol =
		input.netPol !== undefined
			? bundledNetworkPolicy({ podSet: input.podSet, ...input.netPol })
			: undefined;

	return Manifest.make<PodSetResourcesOutput>((ctx) =>
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
