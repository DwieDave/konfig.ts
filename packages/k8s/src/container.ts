
import type { SecretRef, ServiceAccountRef } from "@konfig.ts/core";
import type { EnvVar } from "./env";
import type { Volume } from "./volume";

export interface ContainerInput {
	readonly name: string;
	readonly image: string;
	readonly env?: ReadonlyArray<EnvVar>;
	readonly args?: ReadonlyArray<string>;
	readonly command?: ReadonlyArray<string>;
	readonly imagePullPolicy?: string;
	readonly ports?: ReadonlyArray<{
		readonly containerPort: number;
		readonly name?: string;
		readonly protocol?: string;
	}>;
	readonly resources?: unknown;
	readonly livenessProbe?: unknown;
	readonly readinessProbe?: unknown;
	readonly startupProbe?: unknown;
	readonly lifecycle?: unknown;
	readonly volumeMounts?: ReadonlyArray<{
		readonly name: string;
		readonly mountPath: string;
		readonly readOnly?: boolean;
		readonly subPath?: string;
	}>;
	readonly securityContext?: unknown;
	readonly workingDir?: string;
	readonly tty?: boolean;
	readonly stdin?: boolean;
}

export interface PodSpecInput {
	readonly containers: ReadonlyArray<ContainerInput>;
	readonly initContainers?: ReadonlyArray<ContainerInput>;
	readonly volumes?: ReadonlyArray<Volume>;
	readonly imagePullSecrets?: ReadonlyArray<{ readonly name: SecretRef<string> }>;
	readonly serviceAccountName?: ServiceAccountRef<string> | string;
	readonly restartPolicy?: string;
	readonly terminationGracePeriodSeconds?: number;
	readonly nodeSelector?: Readonly<Record<string, string>>;
	readonly tolerations?: ReadonlyArray<unknown>;
	readonly affinity?: unknown;
	readonly securityContext?: unknown;
	readonly hostAliases?: ReadonlyArray<unknown>;
	readonly hostNetwork?: boolean;
	readonly dnsPolicy?: string;
	readonly dnsConfig?: unknown;
	readonly automountServiceAccountToken?: boolean;
	readonly priorityClassName?: string;
}

export const imagePullSecret = (ref: SecretRef<string>): { readonly name: SecretRef<string> } => ({
	name: ref,
});
