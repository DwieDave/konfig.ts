import { Manifest } from "@konfig.ts/core"
import type {
  NetworkPolicy as K8sNetworkPolicy,
  NetworkPolicyEgressRule as K8sNetworkPolicyEgressRule,
  NetworkPolicyIngressRule as K8sNetworkPolicyIngressRule,
  NetworkPolicyPeer as K8sNetworkPolicyPeer
} from "./.generated/k8s-types"
import { type NamespacedMetaInput, type StringMap, toObjectMeta } from "./meta"
import type { Selector } from "./selector"

export interface NetworkPolicyInput extends NamespacedMetaInput {
  readonly spec: K8sNetworkPolicy["spec"]
}

interface NetworkPolicyPeer {
  readonly podSet?: Selector<StringMap>
  readonly namespaceSelector?: { readonly matchLabels?: StringMap }
  readonly ipBlock?: { readonly cidr: string; readonly except?: ReadonlyArray<string> }
}

interface NetworkPolicyIngressRule {
  readonly from?: ReadonlyArray<NetworkPolicyPeer>
  readonly ports?: K8sNetworkPolicyIngressRule["ports"]
}

interface NetworkPolicyEgressRule {
  readonly to?: ReadonlyArray<NetworkPolicyPeer>
  readonly ports?: K8sNetworkPolicyEgressRule["ports"]
}

export interface NetworkPolicyFromPodSetInput<L extends StringMap> extends NamespacedMetaInput {
  readonly podSet: Selector<L>
  readonly policyTypes?: ReadonlyArray<"Ingress" | "Egress">
  readonly ingress?: ReadonlyArray<NetworkPolicyIngressRule>
  readonly egress?: ReadonlyArray<NetworkPolicyEgressRule>
}

const _podPart = (peer: NetworkPolicyPeer): K8sNetworkPolicyPeer =>
  peer.podSet === undefined ? {} : { podSelector: { matchLabels: { ...peer.podSet.labels } } }

const _namespacePart = (peer: NetworkPolicyPeer): K8sNetworkPolicyPeer =>
  peer.namespaceSelector === undefined ? {} : {
    namespaceSelector: {
      matchLabels: peer.namespaceSelector.matchLabels === undefined
        ? undefined
        : { ...peer.namespaceSelector.matchLabels }
    }
  }

const _ipBlockPart = (peer: NetworkPolicyPeer): K8sNetworkPolicyPeer =>
  peer.ipBlock === undefined ? {} : {
    ipBlock: {
      cidr: peer.ipBlock.cidr,
      except: peer.ipBlock.except === undefined ? undefined : [...peer.ipBlock.except]
    }
  }

const _lowerPeer = (peer: NetworkPolicyPeer): K8sNetworkPolicyPeer => ({
  ..._podPart(peer),
  ..._namespacePart(peer),
  ..._ipBlockPart(peer)
})

export const _policyManifest = (input: NetworkPolicyInput): Manifest.Manifest<K8sNetworkPolicy> =>
  Manifest.make<K8sNetworkPolicy>(() => ({
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: toObjectMeta(input),
    spec: structuredClone(input.spec)
  }))

export const NetworkPolicy = {
  fromPodSet: <L extends StringMap>(
    input: NetworkPolicyFromPodSetInput<L>
  ): Manifest.Manifest<K8sNetworkPolicy> => {
    const ingress = input.ingress?.map((rule): K8sNetworkPolicyIngressRule => ({
      from: rule.from?.map(_lowerPeer),
      ports: rule.ports === undefined ? undefined : [...rule.ports]
    }))

    const egress = input.egress?.map((rule): K8sNetworkPolicyEgressRule => ({
      to: rule.to?.map(_lowerPeer),
      ports: rule.ports === undefined ? undefined : [...rule.ports]
    }))

    return _policyManifest({
      name: input.name,
      namespace: input.namespace,
      labels: input.labels,
      annotations: input.annotations,
      spec: {
        podSelector: { matchLabels: { ...input.podSet.labels } },
        policyTypes: input.policyTypes === undefined ? undefined : [...input.policyTypes],
        ingress,
        egress
      }
    })
  }
}
