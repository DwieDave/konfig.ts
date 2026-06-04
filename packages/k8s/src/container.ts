
import type { SecretRef, ServiceAccountRef } from "@konfig.ts/core";
import type {
	Container as K8sContainer,
	PodSpec as K8sPodSpec,
} from "./.generated/k8s-types";
import type { EnvVar } from "./env";
import type {
	ContainerPort,
	NamesOf,
	PortName,
	ProbeTarget,
} from "./ports";
import type { Volume } from "./volume";

/**
 * Container input — extends the full K8s Container API. Konfig's
 * branded helpers (`secretEnv`, `configMapEnv`) produce `EnvVar`
 * instances whose runtime shape matches `K8sEnvVar`; the override
 * here narrows the field to readonly + the branded helper output so
 * `secretKeyRef.name` carries its `SecretRef<N>` brand at construction
 * time.
 *
 * `image` is overridden as required (K8s lets it be optional for
 * higher-level controllers that default it; konfig wants every
 * container to have an explicit image).
 *
 * `ports[i].name` accepts the branded `PortName<string>` from `port(...)`
 * as well as a raw string; the typed builder `defineContainer` is the
 * link that captures the literal name union for cross-reference checks.
 */
export interface ContainerInput extends Omit<K8sContainer, "env" | "image" | "ports"> {
	readonly image: string;
	readonly env?: ReadonlyArray<EnvVar>;
	readonly ports?: ReadonlyArray<ContainerPort | { readonly containerPort: number; readonly name?: string; readonly protocol?: "TCP" | "UDP" | "SCTP" }>;
}

/**
 * Strongly-typed container builder. Captures the union of named ports
 * declared via `port({ name, containerPort })` as a phantom type
 * parameter, then constrains every probe's `port` field to that union.
 *
 * Pair with `definedService({ forContainer })` in `network.ts` to link
 * a Service's `targetPort` to the same union — a typo or undeclared
 * port name is a compile error.
 */
export interface ContainerSpec<Ports extends string = string>
	extends Omit<ContainerInput, "ports" | "readinessProbe" | "livenessProbe" | "startupProbe"> {
	readonly name: string;
	readonly image: string;
	readonly ports: ReadonlyArray<ContainerPort<Ports>>;
	readonly readinessProbe?: ProbeTarget<Ports>;
	readonly livenessProbe?: ProbeTarget<Ports>;
	readonly startupProbe?: ProbeTarget<Ports>;
	readonly __portNames?: Ports;
}

export interface DefineContainerInput<Ports extends ReadonlyArray<ContainerPort<string>>>
	extends Omit<ContainerInput, "ports" | "readinessProbe" | "livenessProbe" | "startupProbe"> {
	readonly name: string;
	readonly image: string;
	readonly ports: Ports;
	readonly readinessProbe?: ProbeTarget<NamesOf<Ports>>;
	readonly livenessProbe?: ProbeTarget<NamesOf<Ports>>;
	readonly startupProbe?: ProbeTarget<NamesOf<Ports>>;
}

export const defineContainer = <
	const Ports extends ReadonlyArray<ContainerPort<string>>,
>(
	input: DefineContainerInput<Ports>,
): ContainerSpec<NamesOf<Ports>> => {
	type N = NamesOf<Ports>;
	const out: ContainerSpec<N> = {
		...input,
		ports: input.ports as unknown as ReadonlyArray<ContainerPort<N>>,
		readinessProbe: input.readinessProbe,
		livenessProbe: input.livenessProbe,
		startupProbe: input.startupProbe,
	};
	return out;
};

/**
 * Pod spec input — extends K8s PodSpec but tightens the fields where
 * konfig adds brand checking: `imagePullSecrets`, `serviceAccountName`,
 * and `volumes` (the helpers in `volume.ts` produce konfig `Volume`
 * objects that lower to K8s `Volume`).
 */
export interface PodSpecInput
	extends Omit<
		K8sPodSpec,
		| "containers"
		| "initContainers"
		| "volumes"
		| "imagePullSecrets"
		| "serviceAccountName"
	> {
	readonly containers: ReadonlyArray<ContainerInput>;
	readonly initContainers?: ReadonlyArray<ContainerInput>;
	readonly volumes?: ReadonlyArray<Volume>;
	readonly imagePullSecrets?: ReadonlyArray<{ readonly name: SecretRef<string> }>;
	readonly serviceAccountName?: ServiceAccountRef<string> | string;
}

export const imagePullSecret = (ref: SecretRef<string>): { readonly name: SecretRef<string> } => ({
	name: ref,
});
