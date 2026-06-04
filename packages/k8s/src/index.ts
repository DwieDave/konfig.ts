
export * as K8s from "./.generated/k8s-types";
export { type ContainerInput, imagePullSecret, type PodSpecInput } from "./container";

export {
	configMapEnv,
	type EnvVar,
	type EnvVarSource,
	rawEnv,
	secretEnv,
	valueEnv,
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
	type SecretBackend,
} from "./backend";
export { NativeSecret, type NativeSecretOptions } from "./nativeSecret";
export { hashSecretValues, type HashSecretValuesInput } from "./podHash";
export {
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
export {
	emptyDirVolume,
	pvcVolume,
	type Volume,
	volumeFromConfigMap,
	volumeFromSecret,
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
