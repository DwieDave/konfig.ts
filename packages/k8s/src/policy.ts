import { Manifest } from "@konfig.ts/core";
import { Effect } from "effect";
import type {
	ClusterRole as K8sClusterRole,
	ClusterRoleBinding as K8sClusterRoleBinding,
	NetworkPolicy as K8sNetworkPolicy,
	PersistentVolume as K8sPersistentVolume,
	PersistentVolumeClaim as K8sPersistentVolumeClaim,
	Role as K8sRole,
	RoleBinding as K8sRoleBinding,
} from "./.generated/k8s-types";

// Simple constructors — none of these reference Secrets/ConfigMaps in
// the FR-4.4 enumerated positions, so they take raw shape and produce
// a Manifest with Empty R. Anything inside (e.g. PV spec fields) passes
// through verbatim — kubernetes-types provides the structural shape.

interface NamespacedMeta {
	readonly name: string;
	readonly namespace: string;
	readonly labels?: Readonly<Record<string, string>>;
	readonly annotations?: Readonly<Record<string, string>>;
}

interface ClusterMeta {
	readonly name: string;
	readonly labels?: Readonly<Record<string, string>>;
	readonly annotations?: Readonly<Record<string, string>>;
}

// ---------- PersistentVolume ----------

export interface PersistentVolumeInput extends ClusterMeta {
	readonly spec: K8sPersistentVolume["spec"];
}

export const PersistentVolume = {
	make: (input: PersistentVolumeInput): Manifest.Manifest<K8sPersistentVolume> =>
		Manifest.make<K8sPersistentVolume>(() =>
			Effect.succeed({
				apiVersion: "v1",
				kind: "PersistentVolume",
				metadata: {
					name: input.name,
					labels: input.labels,
					annotations: input.annotations,
				},
				spec: input.spec,
			}),
		),
};

// ---------- PersistentVolumeClaim ----------

export interface PersistentVolumeClaimInput extends NamespacedMeta {
	readonly spec: K8sPersistentVolumeClaim["spec"];
}

export const PersistentVolumeClaim = {
	make: (input: PersistentVolumeClaimInput): Manifest.Manifest<K8sPersistentVolumeClaim> =>
		Manifest.make<K8sPersistentVolumeClaim>(() =>
			Effect.succeed({
				apiVersion: "v1",
				kind: "PersistentVolumeClaim",
				metadata: {
					name: input.name,
					namespace: input.namespace,
					labels: input.labels,
					annotations: input.annotations,
				},
				spec: input.spec,
			}),
		),
};

// ---------- NetworkPolicy ----------

export interface NetworkPolicyInput extends NamespacedMeta {
	readonly spec: K8sNetworkPolicy["spec"];
}

export const NetworkPolicy = {
	make: (input: NetworkPolicyInput): Manifest.Manifest<K8sNetworkPolicy> =>
		Manifest.make<K8sNetworkPolicy>(() =>
			Effect.succeed({
				apiVersion: "networking.k8s.io/v1",
				kind: "NetworkPolicy",
				metadata: {
					name: input.name,
					namespace: input.namespace,
					labels: input.labels,
					annotations: input.annotations,
				},
				spec: input.spec,
			}),
		),
};

// ---------- ClusterRole ----------

export interface ClusterRoleInput extends ClusterMeta {
	readonly rules?: K8sClusterRole["rules"];
	readonly aggregationRule?: K8sClusterRole["aggregationRule"];
}

export const ClusterRole = {
	make: (input: ClusterRoleInput): Manifest.Manifest<K8sClusterRole> =>
		Manifest.make<K8sClusterRole>(() =>
			Effect.succeed({
				apiVersion: "rbac.authorization.k8s.io/v1",
				kind: "ClusterRole",
				metadata: {
					name: input.name,
					labels: input.labels,
					annotations: input.annotations,
				},
				rules: input.rules,
				aggregationRule: input.aggregationRule,
			}),
		),
};

// ---------- ClusterRoleBinding ----------

export interface ClusterRoleBindingInput extends ClusterMeta {
	readonly roleRef: K8sClusterRoleBinding["roleRef"];
	readonly subjects?: K8sClusterRoleBinding["subjects"];
}

export const ClusterRoleBinding = {
	make: (input: ClusterRoleBindingInput): Manifest.Manifest<K8sClusterRoleBinding> =>
		Manifest.make<K8sClusterRoleBinding>(() =>
			Effect.succeed({
				apiVersion: "rbac.authorization.k8s.io/v1",
				kind: "ClusterRoleBinding",
				metadata: {
					name: input.name,
					labels: input.labels,
					annotations: input.annotations,
				},
				roleRef: input.roleRef,
				subjects: input.subjects,
			}),
		),
};

// ---------- Role ----------

export interface RoleInput extends NamespacedMeta {
	readonly rules?: K8sRole["rules"];
}

export const Role = {
	make: (input: RoleInput): Manifest.Manifest<K8sRole> =>
		Manifest.make<K8sRole>(() =>
			Effect.succeed({
				apiVersion: "rbac.authorization.k8s.io/v1",
				kind: "Role",
				metadata: {
					name: input.name,
					namespace: input.namespace,
					labels: input.labels,
					annotations: input.annotations,
				},
				rules: input.rules,
			}),
		),
};

// ---------- RoleBinding ----------

export interface RoleBindingInput extends NamespacedMeta {
	readonly roleRef: K8sRoleBinding["roleRef"];
	readonly subjects?: K8sRoleBinding["subjects"];
}

export const RoleBinding = {
	make: (input: RoleBindingInput): Manifest.Manifest<K8sRoleBinding> =>
		Manifest.make<K8sRoleBinding>(() =>
			Effect.succeed({
				apiVersion: "rbac.authorization.k8s.io/v1",
				kind: "RoleBinding",
				metadata: {
					name: input.name,
					namespace: input.namespace,
					labels: input.labels,
					annotations: input.annotations,
				},
				roleRef: input.roleRef,
				subjects: input.subjects,
			}),
		),
};
