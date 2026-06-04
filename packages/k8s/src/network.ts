import { Manifest, type SecretRef, unsafeCoerce } from "@konfig.ts/core";
import { Effect } from "effect";
import type { ContainerSpec } from "./container";
import type {
	Ingress as K8sIngress,
	IngressRule as K8sIngressRule,
	IngressTLS as K8sIngressTLS,
	Service as K8sService,
	ServicePort as K8sServicePort,
} from "./.generated/k8s-types";
import type { IngressBackend as K8sIngressBackend } from "kubernetes-types/networking/v1";
import type { ServicePortSpec } from "./ports";

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
				ports: unsafeCoerce(input.ports, "input.ports is the user-typed Service spec; K8s ServicePort allows the same fields"),
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
	readonly rules?: ReadonlyArray<K8sIngressRule>;
	readonly tls?: ReadonlyArray<IngressTLSInput>;
	readonly defaultBackend?: K8sIngressBackend;
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
				rules: unsafeCoerce(input.rules, "user-supplied Ingress rules; widening from our convenience type to the K8s type"),
				tls: unsafeCoerce<K8sIngressTLS[]>(input.tls, "ingressTLS helper produces K8sIngressTLS with branded secretName"),
				defaultBackend: unsafeCoerce(input.defaultBackend, "user-supplied IngressBackend; structural match to K8s type"),
			},
		};
		return Manifest.make<K8sIngress>(() => Effect.succeed(resource));
	},
};

export const ingressTLS = (input: {
	readonly secretName: SecretRef<string>;
	readonly hosts?: ReadonlyArray<string>;
}): IngressTLSInput => ({ secretName: input.secretName, hosts: input.hosts });

/**
 * Strongly-typed Service input bound to a container's declared port-name
 * union. `selector` and `ports` are required; `ports[i].targetPort`
 * accepts a bare number or `portRef(name)` referencing a name declared
 * on `forContainer`. `NoInfer` locks `Ports` to `forContainer`, so the
 * port list is validated against that union rather than inferred from.
 */
export interface DefinedServiceInput<Ports extends string> {
	readonly name: string;
	readonly namespace: string;
	readonly labels?: Readonly<Record<string, string>>;
	readonly annotations?: Readonly<Record<string, string>>;
	readonly selector: Readonly<Record<string, string>>;
	readonly forContainer: ContainerSpec<Ports>;
	readonly ports: ReadonlyArray<ServicePortSpec<NoInfer<Ports>>>;
	readonly type?: "ClusterIP" | "NodePort" | "LoadBalancer";
	readonly clusterIP?: string;
	readonly sessionAffinity?: string;
	readonly publishNotReadyAddresses?: boolean;
	readonly externalTrafficPolicy?: string;
	readonly internalTrafficPolicy?: string;
}

export const definedService = <Ports extends string>(
	input: DefinedServiceInput<Ports>,
): Manifest.Manifest<K8sService> =>
	Service.make({
		name: input.name,
		namespace: input.namespace,
		labels: input.labels,
		annotations: input.annotations,
		selector: input.selector,
		ports: input.ports as unknown as ReadonlyArray<K8sServicePort>,
		type: input.type,
		clusterIP: input.clusterIP,
		sessionAffinity: input.sessionAffinity,
		publishNotReadyAddresses: input.publishNotReadyAddresses,
		externalTrafficPolicy: input.externalTrafficPolicy,
		internalTrafficPolicy: input.internalTrafficPolicy,
	});
