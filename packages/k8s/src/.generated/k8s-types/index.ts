// Pinned re-export of Kubernetes API types. The directory name is
// historical — we don't regenerate from OpenAPI; we re-export the
// pinned `kubernetes-types` package, which is itself a stable mirror
// of the upstream Kubernetes Go types.
//
// Version policy: `kubernetes-types` is pinned to an exact patch
// version in packages/k8s/package.json — no caret. The minor
// (currently 1.30) tracks the cluster minor we test against. Bumping
// is intentional: read upstream release notes, run `bun run check &&
// bun run test`, and update CHANGELOG.
//
// Each export here is the K8s API type as-is. konfig wrappers (e.g.
// `ContainerInput` in container.ts) accept a wider, branded shape
// and lower into these types when emitting manifests.

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
