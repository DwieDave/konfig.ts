
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
import type { Volume, VolumeMount, VolumeNamesOf } from "./volume";

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
export interface ContainerSpec<Ports extends string = string, Mounts extends string = string>
	extends Omit<
		ContainerInput,
		"ports" | "readinessProbe" | "livenessProbe" | "startupProbe" | "volumeMounts"
	> {
	readonly name: string;
	readonly image: string;
	readonly ports: ReadonlyArray<ContainerPort<Ports>>;
	readonly readinessProbe?: ProbeTarget<Ports>;
	readonly livenessProbe?: ProbeTarget<Ports>;
	readonly startupProbe?: ProbeTarget<Ports>;
	readonly volumeMounts?: ReadonlyArray<VolumeMount<Mounts>>;
	readonly __portNames?: Ports;
	readonly __mountNames?: Mounts;
}

export interface DefineContainerInput<
	Ports extends ReadonlyArray<ContainerPort<string>>,
	Mounts extends ReadonlyArray<VolumeMount<string>>,
> extends Omit<
		ContainerInput,
		"ports" | "readinessProbe" | "livenessProbe" | "startupProbe" | "volumeMounts"
	> {
	readonly name: string;
	readonly image: string;
	readonly ports: Ports;
	readonly readinessProbe?: ProbeTarget<NamesOf<Ports>>;
	readonly livenessProbe?: ProbeTarget<NamesOf<Ports>>;
	readonly startupProbe?: ProbeTarget<NamesOf<Ports>>;
	readonly volumeMounts?: Mounts;
}

type MountNamesOf<M extends ReadonlyArray<VolumeMount<string>>> = {
	readonly [I in keyof M]: M[I] extends VolumeMount<infer N> ? N : never;
}[number];

/**
 * Strongly-typed container builder. Captures the union of named ports
 * (from `port({ name, ... })`) as `Ports`, and the union of mounted
 * volume names (from `mountRef(...)`) as the container's Mounts
 * phantom. The phantoms travel on `ContainerSpec`; `definePod` checks
 * the container's Mounts against the pod's declared volume names.
 *
 * With no volumeMounts, Mounts is `never` — the container makes no
 * volume claims and slots into any pod.
 */
export const defineContainer = <
	const Ports extends ReadonlyArray<ContainerPort<string>>,
	const Mounts extends ReadonlyArray<VolumeMount<string>> = readonly [],
>(
	input: DefineContainerInput<Ports, Mounts>,
): ContainerSpec<NamesOf<Ports>, MountNamesOf<Mounts>> => {
	type P = NamesOf<Ports>;
	type M = MountNamesOf<Mounts>;
	const out: ContainerSpec<P, M> = {
		...input,
		ports: input.ports as unknown as ReadonlyArray<ContainerPort<P>>,
		readinessProbe: input.readinessProbe,
		livenessProbe: input.livenessProbe,
		startupProbe: input.startupProbe,
		volumeMounts: input.volumeMounts as unknown as ReadonlyArray<VolumeMount<M>>,
	};
	return out;
};

/**
 * Pod builder. Takes a tuple of `Volume`s and a list of containers
 * whose `Mounts` phantom is checked against the declared volume names
 * via `NoInfer`. A container referencing an undeclared volume — or a
 * typo — fails at the call site rather than at pod-startup time with
 * "container references volume not found."
 */
export interface DefinePodInput<V extends ReadonlyArray<Volume<string>>> {
	readonly volumes: V;
	readonly containers: ReadonlyArray<ContainerSpec<string, NoInfer<VolumeNamesOf<V>>>>;
	readonly initContainers?: ReadonlyArray<ContainerSpec<string, NoInfer<VolumeNamesOf<V>>>>;
}

export interface DefinedPod<MountNames extends string> {
	readonly volumes: ReadonlyArray<Volume<MountNames>>;
	readonly containers: ReadonlyArray<ContainerSpec<string, MountNames>>;
	readonly initContainers?: ReadonlyArray<ContainerSpec<string, MountNames>>;
}

export const definePod = <const V extends ReadonlyArray<Volume<string>>>(
	input: DefinePodInput<V>,
): DefinedPod<VolumeNamesOf<V>> => ({
	volumes: input.volumes as unknown as ReadonlyArray<Volume<VolumeNamesOf<V>>>,
	containers: input.containers,
	initContainers: input.initContainers,
});

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
