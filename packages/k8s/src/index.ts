export * as K8s from "./.generated/k8s-types"
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
import { Environment as _EnvironmentContract, runtime as envRuntime, Secret as _SecretContract } from "@konfig.ts/env"
import { bindEnvironment } from "./environmentBind"
import { Secret as _SecretIdentity } from "./identity"
import { bindSecret } from "./secretBind"

// Compile-time guard for the namespace merges below: resolves to `false`
// (a type error at the `= true` assignment) if `A` and `B` share a key,
// so a same-named member added upstream can't silently shadow one of
// ours via spread order instead of failing the build.
type IsDisjoint<A, B> = keyof A & keyof B extends never ? true : false

/**
 * `Secret` value namespace — merges the env-contracts side (`define`)
 * with the K8s side (`make`, `bind`, identity helpers). Importing
 * `Secret` from `@konfig.ts/k8s` gives you the full surface:
 *
 *   Secret.define({ name, namespace, env })  — env contract (from @konfig.ts/env)
 *   Secret.make({ name, namespace, stringData })  — K8s Secret manifest
 *   Secret.bind({ secret, backend, source })  — env-to-manifest binder
 */
const _secretContractIdentityDisjoint: IsDisjoint<typeof _SecretContract, typeof _SecretIdentity> = true
const _secretBindDisjoint: IsDisjoint<
  typeof _SecretContract & typeof _SecretIdentity,
  { readonly bind: typeof bindSecret }
> = true
export const Secret = { ..._SecretContract, ..._SecretIdentity, bind: bindSecret }

/**
 * `Environment` value namespace — merges `define` (env-contracts) with
 * `bind` + `runtime` (K8s). The same `Environment` symbol carries the
 * declaration, the manifest binder, and the runtime decoder.
 */
const _environmentBindRuntimeDisjoint: IsDisjoint<
  typeof _EnvironmentContract,
  { readonly bind: typeof bindEnvironment; readonly runtime: typeof envRuntime }
> = true
export const Environment = {
  ..._EnvironmentContract,
  bind: bindEnvironment,
  runtime: envRuntime
}
export { type BackendEmitInput, type BackendTag, type SecretBackend } from "./backend"
export type {
  BindEnvironmentInput,
  DeclaredDownward,
  DeclaredEnvironment,
  DeclaredLiteral,
  DeclaredMember,
  HasSecrets,
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
export { Volume } from "./volume"
export type {
  EmptyVolumeInput,
  VolumeFromConfigMapInput,
  VolumeFromPvcInput,
  VolumeFromSecretInput,
  VolumeMount,
  VolumeName,
  VolumeNamesOf
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
export { Selector } from "./selector"
export type { SelectorLabels } from "./selector"
export * as Workload from "./workloadHelpers"
