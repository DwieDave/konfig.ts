
export * as K8s from "./.generated/k8s-types";
export {
	type ContainerInput,
	type ContainerSpec,
	defineContainer,
	type DefineContainerInput,
	type DefinedPod,
	type DefinePodInput,
	definePod,
	imagePullSecret,
	type PodSpecInput,
} from "./container";
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
	type TcpSocketAction,
} from "./ports";

export {
	type ConfigMapEnvInput,
	EnvVar,
	type EnvVarSource,
	type RawEnvInput,
	type SecretEnvForPodInput,
	type SecretEnvInput,
	type ValueEnvInput,
} from "./env";
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
	type ServiceAccountManifest,
} from "./identity";
import { runtime as envRuntime } from "@konfig.ts/env";
import { Secret as _SecretIdentity } from "./identity";
import { bindSecret } from "./secretBind";
import { bindEnvironment } from "./environmentBind";
export const Secret = { ..._SecretIdentity, bind: bindSecret };
export const Environment = { bind: bindEnvironment, runtime: envRuntime };
export type {
	BindSecretInput,
	DeclaredSecret,
} from "./secretBind";
export type {
	BindEnvironmentInput,
	DeclaredDownward,
	DeclaredEnvironment,
	DeclaredLiteral,
	DeclaredMember,
	HasSecrets,
	SecretMemberOptions,
	SecretMemberOptionsFor,
	SecretMembersOpts,
} from "./environmentBind";
export {
	type BackendEmitInput,
	BackendSourceMissing,
	type BackendTag,
	type SecretBackend,
} from "./backend";
export { NativeSecret, type NativeSecretOptions } from "./nativeSecret";
export { hashSecretValues, type HashSecretValuesInput } from "./podHash";
export {
	type DefinedServiceInput,
	definedService,
	Ingress,
	type IngressInput,
	type IngressTLSInput,
	ingressTLS,
	Service,
	type ServiceInput,
} from "./network";
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
	type RoleInput,
} from "./policy";
export type { ConfigMapRefName, PvcRefName, SecretRefName } from "./refs";
export { ConfigMapRef, PvcRef, SecretRef, ServiceAccountRef } from "./refs";
export { Volume } from "./volume";
export type {
	EmptyVolumeInput,
	VolumeFromConfigMapInput,
	VolumeFromPvcInput,
	VolumeFromSecretInput,
	VolumeMount,
	VolumeName,
	VolumeNamesOf,
} from "./volume";
export {
	CronJob,
	type CronJobInput,
	Deployment,
	type DeploymentInput,
	Job,
	type JobInput,
	StatefulSet,
	type StatefulSetInput,
} from "./workload";

export * as Workload from "./workloadHelpers";
export { Selector } from "./selector";
export type { SelectorLabels } from "./selector";
export {
	type BundledDeploymentInput,
	type BundledEgressRule,
	type BundledIngressRule,
	type BundledNetworkPolicyInput,
	type BundledPeer,
	type BundledServiceInput,
	bundledDeployment,
	bundledNetworkPolicy,
	bundledService,
	type PodSetResourcesInput,
	podSetResources,
} from "./podSet";
