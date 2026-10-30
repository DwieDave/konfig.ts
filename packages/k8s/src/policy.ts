import { Manifest } from "@konfig.ts/core"
import type {
  ClusterRole as K8sClusterRole,
  ClusterRoleBinding as K8sClusterRoleBinding,
  NetworkPolicy as K8sNetworkPolicy,
  NetworkPolicyEgressRule as K8sNetworkPolicyEgressRule,
  NetworkPolicyIngressRule as K8sNetworkPolicyIngressRule,
  NetworkPolicyPeer as K8sNetworkPolicyPeer,
  PersistentVolume as K8sPersistentVolume,
  PersistentVolumeClaim as K8sPersistentVolumeClaim,
  Role as K8sRole,
  RoleBinding as K8sRoleBinding
} from "./.generated/k8s-types"
import {
  cloneList,
  type ClusterMetaInput,
  copyMap,
  type NamespacedMetaInput,
  type StringMap,
  toObjectMeta
} from "./meta"
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

const _buildNetworkPolicy = (input: NetworkPolicyInput): K8sNetworkPolicy => ({
  apiVersion: "networking.k8s.io/v1",
  kind: "NetworkPolicy",
  metadata: toObjectMeta(input),
  spec: structuredClone(input.spec)
})

export const NetworkPolicy = {
  make: (input: NetworkPolicyInput): Manifest.Manifest<K8sNetworkPolicy> =>
    Manifest.make(() => _buildNetworkPolicy(input)),
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

    return NetworkPolicy.make({
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

type PersistentVolumeAccessMode = "ReadWriteOnce" | "ReadOnlyMany" | "ReadWriteMany" | "ReadWriteOncePod"

type PersistentVolumeReclaimPolicy = "Retain" | "Recycle" | "Delete"

type PersistentVolumeMode = "Filesystem" | "Block"

type K8sPersistentVolumeSpec = NonNullable<K8sPersistentVolume["spec"]>

// "At least one volume source" isn't enforced statically (20+ variants); kube-apiserver rejects a spec with none.
interface PersistentVolumeSpecInput extends
  Omit<
    K8sPersistentVolumeSpec,
    "capacity" | "accessModes" | "persistentVolumeReclaimPolicy" | "volumeMode" | "claimRef"
  >
{
  readonly capacity: { readonly storage: string }
  readonly accessModes: ReadonlyArray<PersistentVolumeAccessMode>
  readonly persistentVolumeReclaimPolicy?: PersistentVolumeReclaimPolicy
  readonly volumeMode?: PersistentVolumeMode
  readonly claimRef?: { readonly namespace: string; readonly name: string }
}

export interface PersistentVolumeInput extends ClusterMetaInput {
  readonly spec: PersistentVolumeSpecInput
}

const _lowerPvSpec = (spec: PersistentVolumeSpecInput): K8sPersistentVolumeSpec => ({
  ...structuredClone(spec),
  capacity: { storage: spec.capacity.storage },
  accessModes: [...spec.accessModes],
  claimRef: spec.claimRef === undefined ? undefined : { namespace: spec.claimRef.namespace, name: spec.claimRef.name }
})

export const PersistentVolume = {
  make: (input: PersistentVolumeInput): Manifest.Manifest<K8sPersistentVolume> =>
    Manifest.make<K8sPersistentVolume>(() => ({
      apiVersion: "v1",
      kind: "PersistentVolume",
      metadata: toObjectMeta(input),
      spec: _lowerPvSpec(input.spec)
    }))
}

interface PersistentVolumeClaimSpecInput {
  readonly accessModes: ReadonlyArray<PersistentVolumeAccessMode>
  readonly resources: { readonly requests: { readonly storage: string } }
  readonly storageClassName?: string
  readonly volumeMode?: PersistentVolumeMode
  readonly volumeName?: string
  readonly selector?: { readonly matchLabels?: StringMap }
}

export interface PersistentVolumeClaimInput extends NamespacedMetaInput {
  readonly spec: PersistentVolumeClaimSpecInput
}

const _lowerPvcSpec = (spec: PersistentVolumeClaimSpecInput): K8sPersistentVolumeClaim["spec"] => ({
  accessModes: [...spec.accessModes],
  resources: { requests: { storage: spec.resources.requests.storage } },
  storageClassName: spec.storageClassName,
  volumeMode: spec.volumeMode,
  volumeName: spec.volumeName,
  selector: spec.selector === undefined ? undefined : { matchLabels: copyMap(spec.selector.matchLabels) }
})

export const PersistentVolumeClaim = {
  make: (input: PersistentVolumeClaimInput): Manifest.Manifest<K8sPersistentVolumeClaim> =>
    Manifest.make<K8sPersistentVolumeClaim>(() => ({
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata: toObjectMeta(input),
      spec: _lowerPvcSpec(input.spec)
    }))
}

type PolicyRule = NonNullable<K8sRole["rules"]>[number]

type RbacSubject = NonNullable<K8sRoleBinding["subjects"]>[number]

interface RoleBindingFields {
  readonly roleRef: K8sRoleBinding["roleRef"]
  readonly subjects?: ReadonlyArray<RbacSubject>
}

const _bindingFields = (input: RoleBindingFields) => ({
  roleRef: { ...input.roleRef },
  subjects: cloneList(input.subjects)
})

export interface ClusterRoleInput extends ClusterMetaInput {
  readonly rules?: ReadonlyArray<PolicyRule>
  readonly aggregationRule?: K8sClusterRole["aggregationRule"]
}

export const ClusterRole = {
  make: (input: ClusterRoleInput): Manifest.Manifest<K8sClusterRole> =>
    Manifest.make<K8sClusterRole>(() => ({
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "ClusterRole",
      metadata: toObjectMeta(input),
      rules: cloneList(input.rules),
      aggregationRule: structuredClone(input.aggregationRule)
    }))
}

export interface ClusterRoleBindingInput extends ClusterMetaInput, RoleBindingFields {}

export const ClusterRoleBinding = {
  make: (input: ClusterRoleBindingInput): Manifest.Manifest<K8sClusterRoleBinding> =>
    Manifest.make<K8sClusterRoleBinding>(() => ({
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "ClusterRoleBinding",
      metadata: toObjectMeta(input),
      ..._bindingFields(input)
    }))
}

export interface RoleInput extends NamespacedMetaInput {
  readonly rules?: ReadonlyArray<PolicyRule>
}

export const Role = {
  make: (input: RoleInput): Manifest.Manifest<K8sRole> =>
    Manifest.make<K8sRole>(() => ({
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "Role",
      metadata: toObjectMeta(input),
      rules: cloneList(input.rules)
    }))
}

export interface RoleBindingInput extends NamespacedMetaInput, RoleBindingFields {}

export const RoleBinding = {
  make: (input: RoleBindingInput): Manifest.Manifest<K8sRoleBinding> =>
    Manifest.make<K8sRoleBinding>(() => ({
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "RoleBinding",
      metadata: toObjectMeta(input),
      ..._bindingFields(input)
    }))
}
