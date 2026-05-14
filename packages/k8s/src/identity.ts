// Identity resource constructors: each `X.make` returns a Manifest
// that emits the k8s YAML AND exposes a branded `.ref` for ergonomic
// wiring into env/volume/pull-secret entries within the same module.
//
// M9: the `Single<K, N>` P-tracking on these Manifests is gone — dep
// tracking happens via `yield* Deps.Secret(name)` etc. in the
// surrounding Effect.gen. The `.ref` is still useful as a typed value
// when the caller doesn't want to round-trip through Effect.

import type { ConfigMapRef, SecretRef, ServiceAccountRef } from "@konfig.ts/core";
import { Manifest } from "@konfig.ts/core";
import { Effect } from "effect";
import type {
	ConfigMap as K8sConfigMap,
	Namespace as K8sNamespace,
	Secret as K8sSecret,
	ServiceAccount as K8sServiceAccount,
} from "./.generated/k8s-types";
import {
	ConfigMapRef as ConfigMapRefValue,
	SecretRef as SecretRefValue,
	ServiceAccountRef as ServiceAccountRefValue,
} from "./refs";

type CommonMeta = {
	readonly labels?: Readonly<Record<string, string>>;
	readonly annotations?: Readonly<Record<string, string>>;
};

// ---------- Namespace ----------

export interface NamespaceInput<N extends string> extends CommonMeta {
	readonly name: N;
}

export interface NamespaceManifest<N extends string> extends Manifest.Manifest<K8sNamespace> {
	readonly ref: N;
}

export const Namespace = {
	make: <N extends string>(input: NamespaceInput<N>): NamespaceManifest<N> => {
		const resource: K8sNamespace = {
			apiVersion: "v1",
			kind: "Namespace",
			metadata: {
				name: input.name,
				labels: input.labels,
				annotations: input.annotations,
			},
		};
		const m = Manifest.make<K8sNamespace>(() => Effect.succeed(resource));
		return Object.assign(m, { ref: input.name });
	},
};

// ---------- ServiceAccount ----------

export interface ServiceAccountInput<N extends string> extends CommonMeta {
	readonly name: N;
	readonly namespace: string;
	readonly automountServiceAccountToken?: boolean;
	readonly imagePullSecrets?: ReadonlyArray<{ readonly name: SecretRef<string> }>;
}

export interface ServiceAccountManifest<N extends string>
	extends Manifest.Manifest<K8sServiceAccount> {
	readonly ref: ServiceAccountRef<N>;
}

export const ServiceAccount = {
	make: <N extends string>(input: ServiceAccountInput<N>): ServiceAccountManifest<N> => {
		const resource: K8sServiceAccount = {
			apiVersion: "v1",
			kind: "ServiceAccount",
			metadata: {
				name: input.name,
				namespace: input.namespace,
				labels: input.labels,
				annotations: input.annotations,
			},
			automountServiceAccountToken: input.automountServiceAccountToken,
			imagePullSecrets: input.imagePullSecrets?.map((s) => ({ name: s.name })),
		};
		const m = Manifest.make<K8sServiceAccount>(() => Effect.succeed(resource));
		return Object.assign(m, { ref: ServiceAccountRefValue.of(input.name) });
	},
};

// ---------- ConfigMap ----------

export interface ConfigMapInput<N extends string> extends CommonMeta {
	readonly name: N;
	readonly namespace: string;
	readonly data?: Readonly<Record<string, string>>;
	readonly binaryData?: Readonly<Record<string, string>>;
	readonly immutable?: boolean;
}

export interface ConfigMapManifest<N extends string> extends Manifest.Manifest<K8sConfigMap> {
	readonly ref: ConfigMapRef<N>;
}

export const ConfigMap = {
	make: <N extends string>(input: ConfigMapInput<N>): ConfigMapManifest<N> => {
		const resource: K8sConfigMap = {
			apiVersion: "v1",
			kind: "ConfigMap",
			metadata: {
				name: input.name,
				namespace: input.namespace,
				labels: input.labels,
				annotations: input.annotations,
			},
			data: input.data,
			binaryData: input.binaryData,
			immutable: input.immutable,
		};
		const m = Manifest.make<K8sConfigMap>(() => Effect.succeed(resource));
		return Object.assign(m, { ref: ConfigMapRefValue.of(input.name) });
	},
};

// ---------- Secret ----------

export interface SecretInput<N extends string> extends CommonMeta {
	readonly name: N;
	readonly namespace: string;
	readonly type?: string;
	readonly data?: Readonly<Record<string, string>>;
	readonly stringData?: Readonly<Record<string, string>>;
	readonly immutable?: boolean;
}

export interface SecretManifest<N extends string> extends Manifest.Manifest<K8sSecret> {
	readonly ref: SecretRef<N>;
}

export const Secret = {
	make: <N extends string>(input: SecretInput<N>): SecretManifest<N> => {
		const resource: K8sSecret = {
			apiVersion: "v1",
			kind: "Secret",
			metadata: {
				name: input.name,
				namespace: input.namespace,
				labels: input.labels,
				annotations: input.annotations,
			},
			type: input.type,
			data: input.data,
			stringData: input.stringData,
			immutable: input.immutable,
		};
		const m = Manifest.make<K8sSecret>(() => Effect.succeed(resource));
		return Object.assign(m, { ref: SecretRefValue.of(input.name) });
	},
};
