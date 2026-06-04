
import type { SecretRef, ServiceAccountRef } from "@konfig.ts/core";
import type {
	Container as K8sContainer,
	PodSpec as K8sPodSpec,
} from "./.generated/k8s-types";
import type { EnvVar } from "./env";
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
 */
export interface ContainerInput extends Omit<K8sContainer, "env" | "image"> {
	readonly image: string;
	readonly env?: ReadonlyArray<EnvVar>;
}

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
