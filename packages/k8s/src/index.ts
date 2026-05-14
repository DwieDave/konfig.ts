// @konfig.ts/k8s — Kubernetes resource constructors with branded references.
//
// M9: dep tracking lives in `@konfig.ts/core`'s `Deps.*` yieldable Keys.
// This package provides the RESOURCE CONSTRUCTORS (Deployment, Service,
// Ingress, etc.) that emit k8s YAML. Branded refs (`SecretRef<N>`,
// `ConfigMapRef<N>`, `ServiceAccountRef<N>`) come from yielding the
// corresponding Key upstream — they reject raw strings at the FR-4.4
// enforcement points (env vars, volumes, imagePullSecrets, TLS).

// Type re-exports from k8s 1.30 OpenAPI (via `kubernetes-types`).
export * as K8s from "./.generated/k8s-types";
// Container + PodSpec input shapes.
export { type ContainerInput, imagePullSecret, type PodSpecInput } from "./container";

// Env-var helpers.
export {
	configMapEnv,
	type EnvVar,
	type EnvVarSource,
	rawEnv,
	secretEnv,
	valueEnv,
} from "./env";
// Identity constructors (Namespace, ServiceAccount, ConfigMap, Secret)
// — each returns a Manifest carrying `.ref` so consumers can wire it
// into env/volumes/pull-secrets without recomputing the ref by hand.
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
// Network-tier constructors (Service, Ingress) + Ingress TLS helper.
export {
	Ingress,
	type IngressInput,
	type IngressTLSInput,
	ingressTLS,
	Service,
	type ServiceInput,
} from "./network";
// Policy + cluster-level resources.
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
// Branded ref TYPES come from `@konfig.ts/core/deps`; the local `.of()`
// factories remain for legacy call sites that need to brand a raw
// string outside an Effect.gen context. Re-exports merge the type +
// value sides of each (TypeScript declaration merging).
export type { ConfigMapRefName, PvcRefName, SecretRefName } from "./refs";
export { ConfigMapRef, PvcRef, SecretRef, ServiceAccountRef } from "./refs";
// Volume helpers.
export {
	emptyDirVolume,
	pvcVolume,
	type Volume,
	volumeFromConfigMap,
	volumeFromSecret,
} from "./volume";
// Workload-tier constructors (Deployment, StatefulSet, Job, CronJob).
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

// Higher-level helpers for the common Workload shapes (web + cron).
export * as Workload from "./workloadHelpers";
