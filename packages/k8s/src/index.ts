import { Environment as _EnvironmentContract, runtime as envRuntime, Secret as _SecretContract } from "@konfig.ts/env"
import { bindEnvironment } from "./environmentBind"
import { Secret as _SecretIdentity } from "./identity"
import { bindSecret } from "./secretBind"

export * as K8s from "./.generated/k8s-types"

export { Backend } from "./api"

export type { BackendEmitInput, BackendTag, SecretBackend } from "./backendKit"

export {
  Container,
  type ContainerInput,
  type ContainerSpec,
  type DefineContainerInput,
  type DefinedPod,
  type DefinePodInput,
  Pod,
  type PodSpecInput
} from "./container"

export {
  type ContainerPort,
  type ContainerProtocol,
  type ExecAction,
  type GrpcAction,
  type HttpGetAction,
  type HttpHeader,
  type NamesOf,
  Port,
  type PortInput,
  type PortName,
  type ProbeTarget,
  type ServicePortSpec,
  type TcpSocketAction
} from "./ports"

export {
  type ConfigMapEnvInput,
  EnvVar,
  type EnvVarSource,
  type RawEnvInput,
  type SecretEnvForPodInput,
  type SecretEnvInput,
  type ValueEnvInput
} from "./env"

export {
  ConfigMap,
  type ConfigMapInput,
  type ConfigMapManifest,
  Namespace,
  type NamespaceInput,
  type NamespaceManifest,
  type SecretInput,
  type SecretManifest,
  ServiceAccount,
  type ServiceAccountInput,
  type ServiceAccountManifest
} from "./identity"

export const Secret = { ..._SecretContract, ..._SecretIdentity, bind: bindSecret }

export const Environment = {
  ..._EnvironmentContract,
  bind: bindEnvironment,
  runtime: envRuntime
}

export type {
  BindEnvironmentInput,
  DeclaredDownward,
  DeclaredEnvironment,
  DeclaredLiteral,
  DeclaredMember,
  HasSecrets,
  SecretMemberInput,
  SecretMemberInputFor,
  SecretMemberOptions,
  SecretMemberOptionsFor,
  SecretMembersOpts
} from "./environmentBind"

export { NativeSecret, type NativeSecretOptions } from "./nativeSecret"

export {
  Ingress,
  type IngressInput,
  type IngressTLSInput,
  Service,
  type ServiceFromContainerInput,
  type ServiceFromPodSetInput,
  type ServiceInput
} from "./network"

export { hashSecretValues, type HashSecretValuesInput } from "./podHash"

export {
  ClusterRole,
  ClusterRoleBinding,
  type ClusterRoleBindingInput,
  type ClusterRoleInput,
  NetworkPolicy,
  type NetworkPolicyEgressRule,
  type NetworkPolicyFromPodSetInput,
  type NetworkPolicyIngressRule,
  type NetworkPolicyInput,
  type NetworkPolicyPeer,
  PersistentVolume,
  PersistentVolumeClaim,
  type PersistentVolumeClaimInput,
  type PersistentVolumeInput,
  Role,
  RoleBinding,
  type RoleBindingInput,
  type RoleInput
} from "./policy"

export type { ConfigMapRefName, PvcRefName, SecretRefName } from "./refs"

export { ConfigMapRef, PvcRef, SecretRef, ServiceAccountRef } from "./refs"

export type { BindSecretInput, DeclaredSecret } from "./secretBind"

export {
  type EmptyVolumeInput,
  Volume,
  type VolumeFromConfigMapInput,
  type VolumeFromPvcInput,
  type VolumeFromSecretInput,
  type VolumeMount,
  type VolumeName,
  type VolumeNamesOf
} from "./volume"

export {
  CronJob,
  type CronJobInput,
  Deployment,
  type DeploymentFromPodSetInput,
  type DeploymentInput,
  Job,
  type JobInput,
  StatefulSet,
  type StatefulSetInput
} from "./workload"

export { type DefinePodSetInput, PodSet } from "./podSet"

export { Selector, type SelectorLabels } from "./selector"

export * as Workload from "./workloadHelpers"
