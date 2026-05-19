
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
