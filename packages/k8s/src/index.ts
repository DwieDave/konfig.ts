import { Environment as _EnvironmentContract, runtime as envRuntime, Secret as _SecretContract } from "@konfig.ts/env"
import { bindEnvironment } from "./environmentBind"
import { Secret as _SecretIdentity } from "./identity"
import { bindSecret } from "./secretBind"

export * as K8s from "./.generated/k8s-types"

export { Backend } from "./api"

export { Container, Pod } from "./container"

export { Port } from "./ports"

export { EnvVar, type RawEnvInput } from "./env"

export { ConfigMap, Namespace, ServiceAccount, type ServiceAccountInput, type ServiceAccountManifest } from "./identity"

export const Secret = { ..._SecretContract, ..._SecretIdentity, bind: bindSecret }

export const Environment = {
  ..._EnvironmentContract,
  bind: bindEnvironment,
  runtime: envRuntime
}

export { NativeSecret } from "./nativeSecret"

export {
  Ingress,
  type IngressInput,
  type IngressTLSInput,
  Service,
  type ServiceFromPodSetInput,
  type ServiceInput
} from "./network"

export { hashSecretValues } from "./podHash"

export {
  ClusterRole,
  ClusterRoleBinding,
  type ClusterRoleBindingInput,
  type ClusterRoleInput,
  NetworkPolicy,
  type NetworkPolicyInput,
  PersistentVolume,
  PersistentVolumeClaim,
  type PersistentVolumeClaimInput,
  type PersistentVolumeInput,
  Role,
  RoleBinding,
  type RoleBindingInput,
  type RoleInput
} from "./policy"

export { ConfigMapRef, PvcRef, SecretRef, ServiceAccountRef } from "./refs"

export { type EmptyVolumeInput, Volume, type VolumeFromConfigMapInput, type VolumeFromSecretInput } from "./volume"

export {
  CronJob,
  type CronJobInput,
  Deployment,
  Job,
  type JobInput,
  StatefulSet,
  type StatefulSetInput
} from "./workload"

export { type DefinePodSetInput, PodSet } from "./podSet"

export { Selector } from "./selector"

export * as Workload from "./workloadHelpers"
