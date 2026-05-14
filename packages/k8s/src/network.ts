// Service + Ingress resource constructors. M9 dropped the
// TLS-R-aggregating generics; the Ingress dep on its TLS secret is
// now declared upstream via `yield* Secret(name)` in the surrounding
// Effect.gen.

import type { SecretRef } from "@konfig.ts/core";
import { Manifest } from "@konfig.ts/core";
import { Effect } from "effect";
import type {
	Ingress as K8sIngress,
	IngressTLS as K8sIngressTLS,
	Service as K8sService,
	ServicePort as K8sServicePort,
} from "./.generated/k8s-types";

// ---------- Service ----------

export interface ServiceInput {
	readonly name: string;
	readonly namespace: string;
	readonly labels?: Readonly<Record<string, string>>;
	readonly annotations?: Readonly<Record<string, string>>;
	readonly selector?: Readonly<Record<string, string>>;
	readonly type?: "ClusterIP" | "NodePort" | "LoadBalancer" | "ExternalName";
	readonly ports?: ReadonlyArray<K8sServicePort>;
	readonly clusterIP?: string;
	readonly externalName?: string;
	readonly sessionAffinity?: string;
	readonly publishNotReadyAddresses?: boolean;
	readonly externalTrafficPolicy?: string;
	readonly internalTrafficPolicy?: string;
}

export const Service = {
	make: (input: ServiceInput): Manifest.Manifest<K8sService> => {
		const resource: K8sService = {
			apiVersion: "v1",
			kind: "Service",
			metadata: {
				name: input.name,
				namespace: input.namespace,
				labels: input.labels,
				annotations: input.annotations,
			},
			spec: {
				selector: input.selector,
				type: input.type,
				ports: input.ports as never,
				clusterIP: input.clusterIP,
				externalName: input.externalName,
				sessionAffinity: input.sessionAffinity,
				publishNotReadyAddresses: input.publishNotReadyAddresses,
				externalTrafficPolicy: input.externalTrafficPolicy,
				internalTrafficPolicy: input.internalTrafficPolicy,
			},
		};
		return Manifest.make<K8sService>(() => Effect.succeed(resource));
	},
};

// ---------- Ingress ----------

// Typed TLS entry: secretName is a branded `SecretRef<N>` obtained via
// `yield* Secret(name)` upstream.
export interface IngressTLSInput {
	readonly hosts?: ReadonlyArray<string>;
	readonly secretName: SecretRef<string>;
}

export interface IngressInput {
	readonly name: string;
	readonly namespace: string;
	readonly labels?: Readonly<Record<string, string>>;
	readonly annotations?: Readonly<Record<string, string>>;
	readonly ingressClassName?: string;
	readonly rules?: ReadonlyArray<unknown>;
	readonly tls?: ReadonlyArray<IngressTLSInput>;
	readonly defaultBackend?: unknown;
}

export const Ingress = {
	make: (input: IngressInput): Manifest.Manifest<K8sIngress> => {
		const resource: K8sIngress = {
			apiVersion: "networking.k8s.io/v1",
			kind: "Ingress",
			metadata: {
				name: input.name,
				namespace: input.namespace,
				labels: input.labels,
				annotations: input.annotations,
			},
			spec: {
				ingressClassName: input.ingressClassName,
				rules: input.rules as never,
				tls: input.tls as unknown as K8sIngressTLS[],
				defaultBackend: input.defaultBackend as never,
			},
		};
		return Manifest.make<K8sIngress>(() => Effect.succeed(resource));
	},
};

// Convenience used by the higher-level Workload helpers + by ports.
export const ingressTLS = (
	secretName: SecretRef<string>,
	hosts?: ReadonlyArray<string>,
): IngressTLSInput => ({ secretName, hosts });
