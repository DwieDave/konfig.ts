// Container/PodSpec input shapes. M9 dropped the R-aggregating
// `EnvVarsR`/`VolumesR`/`PullSecretsR`/`PodSpecR` — dep tracking now
// flows via Effect.gen yielding the upstream Key (`Secret(name)`,
// `ConfigMap(name)`, etc.) BEFORE constructing the env/volume/pull
// entries. The constructed entries here carry no phantom brand;
// they're plain records matching `kubernetes-types`.

import type { ServiceAccountRef } from "@konfig.ts/core";
import type { SecretRef } from "@konfig.ts/core";
import type { EnvVar } from "./env";
import type { Volume } from "./volume";

// Container input — typed FR-4.4 fields (env), loose for the rest.
// Everything not enumerated here (resources, probes, lifecycle, ports,
// args, command, etc.) passes through verbatim to the rendered output.
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

// Pod-spec input — typed containers + volumes + imagePullSecrets +
// serviceAccountName. Everything else passes through.
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

// Typed image-pull secret helper. Caller must obtain the `SecretRef<N>`
// via `yield* Secret(name)` upstream.
export const imagePullSecret = (
	ref: SecretRef<string>,
): { readonly name: SecretRef<string> } => ({ name: ref });
