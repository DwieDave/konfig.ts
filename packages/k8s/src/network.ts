import { coerce, Manifest, type SecretRef } from "@konfig.ts/core";
import { Effect } from "effect";
import type {
	Ingress as K8sIngress,
	IngressTLS as K8sIngressTLS,
	Service as K8sService,
	ServicePort as K8sServicePort,
} from "./.generated/k8s-types";

/**
 * Strict input for a `Service`. `selector` and `ports` are required:
 * a Service with no selector has no endpoints, and one with no ports
 * is meaningless. ServicePort needs at minimum a `port`; the upstream
 * `K8sServicePort` only marks `port` as required — names/protocol
 * defaults match kube-apiserver behaviour.
 */
export interface ServiceInput {
	readonly name: string;
	readonly namespace: string;
	readonly labels?: Readonly<Record<string, string>>;
	readonly annotations?: Readonly<Record<string, string>>;
	readonly selector: Readonly<Record<string, string>>;
	readonly ports: ReadonlyArray<K8sServicePort>;
	readonly type?: "ClusterIP" | "NodePort" | "LoadBalancer";
	readonly clusterIP?: string;
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
				ports: coerce(input.ports),
				clusterIP: input.clusterIP,
				sessionAffinity: input.sessionAffinity,
				publishNotReadyAddresses: input.publishNotReadyAddresses,
				externalTrafficPolicy: input.externalTrafficPolicy,
				internalTrafficPolicy: input.internalTrafficPolicy,
			},
		};
		return Manifest.make<K8sService>(() => Effect.succeed(resource));
	},
};

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
				rules: coerce(input.rules),
				tls: coerce<K8sIngressTLS[]>(input.tls),
				defaultBackend: coerce(input.defaultBackend),
			},
		};
		return Manifest.make<K8sIngress>(() => Effect.succeed(resource));
	},
};

export const ingressTLS = (input: {
	readonly secretName: SecretRef<string>;
	readonly hosts?: ReadonlyArray<string>;
}): IngressTLSInput => ({ secretName: input.secretName, hosts: input.hosts });
