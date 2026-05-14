// k8s 1.30 OpenAPI types — re-exported from `kubernetes-types`.
//
// We import from `kubernetes-types` rather than generating our own
// codegen output: the package is already pinned at 1.30.0 (matching
// our cluster), is a transitive dep of `effect`, and saves ~5k LOC of
// committed codegen artifacts. The `kubernetes-types` namespace shape
// matches the k8s OpenAPI exactly, so callers get full IntelliSense.
//
// Add narrower re-exports here as constructors need them; this file
// stays small on purpose.

export type {
	Deployment,
	DeploymentSpec,
	StatefulSet,
	StatefulSetSpec,
} from "kubernetes-types/apps/v1";

export type {
	CronJob,
	Job,
	JobSpec,
} from "kubernetes-types/batch/v1";
export type {
	ConfigMap,
	Container,
	ContainerPort,
	EnvVar,
	EnvVarSource,
	LocalObjectReference,
	Namespace,
	PersistentVolume,
	PersistentVolumeClaim,
	PodSpec,
	PodTemplateSpec,
	Secret,
	Service,
	ServiceAccount,
	ServicePort,
	Volume,
	VolumeMount,
} from "kubernetes-types/core/v1";
export type { ObjectMeta } from "kubernetes-types/meta/v1";
export type {
	Ingress,
	IngressRule,
	IngressSpec,
	IngressTLS,
	NetworkPolicy,
} from "kubernetes-types/networking/v1";
export type {
	ClusterRole,
	ClusterRoleBinding,
	Role,
	RoleBinding,
} from "kubernetes-types/rbac/v1";
