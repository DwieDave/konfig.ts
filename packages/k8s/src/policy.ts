import { Manifest, unsafeCoerce } from "@konfig.ts/core"
import { Effect } from "effect"
import type { PersistentVolumeSpec as K8sPersistentVolumeSpec } from "kubernetes-types/core/v1"
import type {
  NetworkPolicyEgressRule as K8sNetworkPolicyEgressRule,
  NetworkPolicyIngressRule as K8sNetworkPolicyIngressRule
} from "kubernetes-types/networking/v1"
import type {
  ClusterRole as K8sClusterRole,
  ClusterRoleBinding as K8sClusterRoleBinding,
  NetworkPolicy as K8sNetworkPolicy,
  PersistentVolume as K8sPersistentVolume,
  PersistentVolumeClaim as K8sPersistentVolumeClaim,
  Role as K8sRole,
  RoleBinding as K8sRoleBinding
} from "./.generated/k8s-types"
import type { Selector } from "./selector"

interface NamespacedMeta {
  readonly name: string
  readonly namespace: string
  readonly labels?: Readonly<Record<string, string>>
  readonly annotations?: Readonly<Record<string, string>>
}

interface ClusterMeta {
  readonly name: string
  readonly labels?: Readonly<Record<string, string>>
  readonly annotations?: Readonly<Record<string, string>>
}

export type PersistentVolumeAccessMode =
  | "ReadWriteOnce"
  | "ReadOnlyMany"
  | "ReadWriteMany"
  | "ReadWriteOncePod"

export type PersistentVolumeReclaimPolicy = "Retain" | "Recycle" | "Delete"

export type PersistentVolumeMode = "Filesystem" | "Block"

// "At least one volume source" isn't enforced statically (20+ variants); kube-apiserver rejects a spec with none.
export interface PersistentVolumeSpecInput extends
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

export interface PersistentVolumeInput extends ClusterMeta {
  readonly spec: PersistentVolumeSpecInput
}

export const PersistentVolume = {
  make: (input: PersistentVolumeInput): Manifest.Manifest<K8sPersistentVolume> =>
    Manifest.make<K8sPersistentVolume>(() =>
      Effect.succeed({
        apiVersion: "v1",
        kind: "PersistentVolume",
        metadata: {
          name: input.name,
          labels: input.labels,
          annotations: input.annotations
        },
        spec: unsafeCoerce<K8sPersistentVolume["spec"]>(
          input.spec,
          "user-supplied PV spec; structural match to the K8s type"
        )
      })
    )
}

export interface PersistentVolumeClaimSpecInput {
  readonly accessModes: ReadonlyArray<PersistentVolumeAccessMode>
  readonly resources: { readonly requests: { readonly storage: string } }
  readonly storageClassName?: string
  readonly volumeMode?: PersistentVolumeMode
  readonly volumeName?: string
  readonly selector?: { readonly matchLabels?: Readonly<Record<string, string>> }
}

export interface PersistentVolumeClaimInput extends NamespacedMeta {
  readonly spec: PersistentVolumeClaimSpecInput
}

export const PersistentVolumeClaim = {
  make: (input: PersistentVolumeClaimInput): Manifest.Manifest<K8sPersistentVolumeClaim> =>
    Manifest.make<K8sPersistentVolumeClaim>(() =>
      Effect.succeed({
        apiVersion: "v1",
        kind: "PersistentVolumeClaim",
        metadata: {
          name: input.name,
          namespace: input.namespace,
          labels: input.labels,
          annotations: input.annotations
        },
        spec: unsafeCoerce<K8sPersistentVolumeClaim["spec"]>(
          input.spec,
          "user-supplied PVC spec; structural match to the K8s type"
        )
      })
    )
}

export interface NetworkPolicyInput extends NamespacedMeta {
  readonly spec: K8sNetworkPolicy["spec"]
}

export interface NetworkPolicyPeer {
  readonly podSet?: Selector<Readonly<Record<string, string>>>
  readonly namespaceSelector?: { readonly matchLabels?: Readonly<Record<string, string>> }
  readonly ipBlock?: { readonly cidr: string; readonly except?: ReadonlyArray<string> }
}

export interface NetworkPolicyIngressRule {
  readonly from?: ReadonlyArray<NetworkPolicyPeer>
  readonly ports?: K8sNetworkPolicyIngressRule["ports"]
}

export interface NetworkPolicyEgressRule {
  readonly to?: ReadonlyArray<NetworkPolicyPeer>
  readonly ports?: K8sNetworkPolicyEgressRule["ports"]
}

export interface NetworkPolicyFromPodSetInput<L extends Readonly<Record<string, string>>> extends NamespacedMeta {
  readonly podSet: Selector<L>
  readonly policyTypes?: ReadonlyArray<"Ingress" | "Egress">
  readonly ingress?: ReadonlyArray<NetworkPolicyIngressRule>
  readonly egress?: ReadonlyArray<NetworkPolicyEgressRule>
}

const _lowerPeer = (peer: NetworkPolicyPeer): {
  readonly podSelector?: { readonly matchLabels?: Readonly<Record<string, string>> }
  readonly namespaceSelector?: { readonly matchLabels?: Readonly<Record<string, string>> }
  readonly ipBlock?: { readonly cidr: string; readonly except?: ReadonlyArray<string> }
} => ({
  ...(peer.podSet !== undefined ? { podSelector: { matchLabels: peer.podSet.labels } } : {}),
  ...(peer.namespaceSelector !== undefined ? { namespaceSelector: peer.namespaceSelector } : {}),
  ...(peer.ipBlock !== undefined ? { ipBlock: peer.ipBlock } : {})
})

export const NetworkPolicy = {
  make: (input: NetworkPolicyInput): Manifest.Manifest<K8sNetworkPolicy> =>
    Manifest.make<K8sNetworkPolicy>(() =>
      Effect.succeed({
        apiVersion: "networking.k8s.io/v1",
        kind: "NetworkPolicy",
        metadata: {
          name: input.name,
          namespace: input.namespace,
          labels: input.labels,
          annotations: input.annotations
        },
        spec: input.spec
      })
    ),
  fromPodSet: <L extends Readonly<Record<string, string>>>(
    input: NetworkPolicyFromPodSetInput<L>
  ): Manifest.Manifest<K8sNetworkPolicy> => {
    const ingress = input.ingress?.map((rule) => ({
      from: rule.from?.map(_lowerPeer),
      ports: rule.ports
    }))
    const egress = input.egress?.map((rule) => ({
      to: rule.to?.map(_lowerPeer),
      ports: rule.ports
    }))
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
          egress
        },
        "konfig peers carry readonly arrays; upstream NetworkPolicySpec is mutable but the runtime shape matches"
      )
    })
  }
}

export interface ClusterRoleInput extends ClusterMeta {
  readonly rules?: K8sClusterRole["rules"]
  readonly aggregationRule?: K8sClusterRole["aggregationRule"]
}

export const ClusterRole = {
  make: (input: ClusterRoleInput): Manifest.Manifest<K8sClusterRole> =>
    Manifest.make<K8sClusterRole>(() =>
      Effect.succeed({
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "ClusterRole",
        metadata: {
          name: input.name,
          labels: input.labels,
          annotations: input.annotations
        },
        rules: input.rules,
        aggregationRule: input.aggregationRule
      })
    )
}

export interface ClusterRoleBindingInput extends ClusterMeta {
  readonly roleRef: K8sClusterRoleBinding["roleRef"]
  readonly subjects?: K8sClusterRoleBinding["subjects"]
}

export const ClusterRoleBinding = {
  make: (input: ClusterRoleBindingInput): Manifest.Manifest<K8sClusterRoleBinding> =>
    Manifest.make<K8sClusterRoleBinding>(() =>
      Effect.succeed({
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "ClusterRoleBinding",
        metadata: {
          name: input.name,
          labels: input.labels,
          annotations: input.annotations
        },
        roleRef: input.roleRef,
        subjects: input.subjects
      })
    )
}

export interface RoleInput extends NamespacedMeta {
  readonly rules?: K8sRole["rules"]
}

export const Role = {
  make: (input: RoleInput): Manifest.Manifest<K8sRole> =>
    Manifest.make<K8sRole>(() =>
      Effect.succeed({
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "Role",
        metadata: {
          name: input.name,
          namespace: input.namespace,
          labels: input.labels,
          annotations: input.annotations
        },
        rules: input.rules
      })
    )
}

export interface RoleBindingInput extends NamespacedMeta {
  readonly roleRef: K8sRoleBinding["roleRef"]
  readonly subjects?: K8sRoleBinding["subjects"]
}

export const RoleBinding = {
  make: (input: RoleBindingInput): Manifest.Manifest<K8sRoleBinding> =>
    Manifest.make<K8sRoleBinding>(() =>
      Effect.succeed({
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "RoleBinding",
        metadata: {
          name: input.name,
          namespace: input.namespace,
          labels: input.labels,
          annotations: input.annotations
        },
        roleRef: input.roleRef,
        subjects: input.subjects
      })
    )
}
