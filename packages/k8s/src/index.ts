
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
	Secret,
	type SecretInput,
	type SecretManifest,
	ServiceAccount,
	type ServiceAccountInput,
	type ServiceAccountManifest,
} from "./identity";
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
