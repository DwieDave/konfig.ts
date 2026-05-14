// High-level helpers for the common Workload shapes (web + cron).
// Built only with the surface consumers need today — do not add
// speculative options. The shape here drives the boilerplate that
// module code avoids by reusing this.
//
// Shared label convention: every workload gets an `app` label that the
// Service selects on and the Pod template carries.
//
// M9: the R-aggregating generics were dropped along with EnvVarsR /
// VolumesR / PullSecretsR. Dep tracking now flows via Effect.gen
// yielding the upstream `Secret(name)` / `ConfigMap(name)` etc. Keys.

import type { Manifest } from "@konfig.ts/core";
import type { SecretRef } from "@konfig.ts/core";
import { Manifest as M } from "@konfig.ts/core";
import { Effect } from "effect";
import type {
	CronJob as K8sCronJob,
	Deployment as K8sDeployment,
	Ingress as K8sIngress,
	Service as K8sService,
	ServiceAccount as K8sServiceAccount,
	ServicePort as K8sServicePort,
} from "./.generated/k8s-types";
import type { ContainerInput } from "./container";
import type { EnvVar } from "./env";
import { Ingress, type IngressTLSInput, Service } from "./network";
import type { Volume } from "./volume";
import { CronJob, Deployment } from "./workload";

// ---------- web (Deployment + Service [+ Ingress]) ----------

interface WebInput {
	readonly name: string;
	readonly namespace: string;
	readonly labels?: Readonly<Record<string, string>>;
	readonly annotations?: Readonly<Record<string, string>>;
	readonly deployment: {
		readonly replicas?: number;
		readonly containers: ReadonlyArray<ContainerInput>;
		readonly volumes?: ReadonlyArray<Volume>;
		readonly imagePullSecrets?: ReadonlyArray<{ readonly name: SecretRef<string> }>;
		readonly serviceAccountName?: string;
		readonly podLabels?: Readonly<Record<string, string>>;
		readonly podAnnotations?: Readonly<Record<string, string>>;
	};
	readonly service: {
		readonly ports: ReadonlyArray<K8sServicePort>;
		readonly type?: "ClusterIP" | "NodePort" | "LoadBalancer";
	};
	readonly ingress?: {
		readonly ingressClassName?: string;
		readonly rules?: ReadonlyArray<unknown>;
		readonly tls?: ReadonlyArray<IngressTLSInput>;
		readonly annotations?: Readonly<Record<string, string>>;
	};
}

export const web = (
	input: WebInput,
): Manifest.Manifest<
	readonly [K8sDeployment, K8sService] | readonly [K8sDeployment, K8sService, K8sIngress]
> => {
	const selectorLabels = { app: input.name };
	const podLabels = { ...selectorLabels, ...(input.deployment.podLabels ?? {}) };

	const deployment = Deployment.make({
		name: input.name,
		namespace: input.namespace,
		labels: { ...selectorLabels, ...(input.labels ?? {}) },
		annotations: input.annotations,
		replicas: input.deployment.replicas,
		selector: { matchLabels: selectorLabels },
		template: {
			metadata: { labels: podLabels, annotations: input.deployment.podAnnotations },
			spec: {
				containers: input.deployment.containers,
				volumes: input.deployment.volumes,
				imagePullSecrets: input.deployment.imagePullSecrets,
				serviceAccountName: input.deployment.serviceAccountName,
			},
		},
	});

	const service = Service.make({
		name: input.name,
		namespace: input.namespace,
		labels: { ...selectorLabels, ...(input.labels ?? {}) },
		annotations: input.annotations,
		selector: selectorLabels,
		type: input.service.type ?? "ClusterIP",
		ports: input.service.ports,
	});

	if (input.ingress === undefined) {
		return M.make((ctx) =>
			Effect.all([deployment.render(ctx), service.render(ctx)], { concurrency: "unbounded" }),
		);
	}

	const ingress = Ingress.make({
		name: input.name,
		namespace: input.namespace,
		labels: { ...selectorLabels, ...(input.labels ?? {}) },
		annotations: { ...(input.annotations ?? {}), ...(input.ingress.annotations ?? {}) },
		ingressClassName: input.ingress.ingressClassName,
		rules: input.ingress.rules,
		tls: input.ingress.tls,
	});

	return M.make((ctx) =>
		Effect.all([deployment.render(ctx), service.render(ctx), ingress.render(ctx)], {
			concurrency: "unbounded",
		}),
	);
};

// ---------- cron (CronJob + ServiceAccount) ----------

interface CronInput {
	readonly name: string;
	readonly namespace: string;
	readonly schedule: string;
	readonly labels?: Readonly<Record<string, string>>;
	readonly annotations?: Readonly<Record<string, string>>;
	readonly concurrencyPolicy?: "Allow" | "Forbid" | "Replace";
	readonly successfulJobsHistoryLimit?: number;
	readonly failedJobsHistoryLimit?: number;
	readonly containers: ReadonlyArray<ContainerInput>;
	readonly volumes?: ReadonlyArray<Volume>;
	readonly imagePullSecrets?: ReadonlyArray<{ readonly name: SecretRef<string> }>;
	readonly restartPolicy?: "OnFailure" | "Never";
}

export const cron = (
	input: CronInput,
): Manifest.Manifest<readonly [K8sServiceAccount, K8sCronJob]> => {
	const selectorLabels = { app: input.name };

	// The SA is private to this cron, so we build it inline (not via the
	// identity helper) — its name is not promoted into the resulting
	// Manifest's `P`. The CronJob's pod template uses
	// `serviceAccountName: input.name` directly.
	const sa: Manifest.Manifest<K8sServiceAccount> = M.make<K8sServiceAccount>(() =>
		Effect.succeed({
			apiVersion: "v1",
			kind: "ServiceAccount",
			metadata: {
				name: input.name,
				namespace: input.namespace,
				labels: { ...selectorLabels, ...(input.labels ?? {}) },
				annotations: input.annotations,
			},
		}),
	);

	const cronJob = CronJob.make({
		name: input.name,
		namespace: input.namespace,
		labels: { ...selectorLabels, ...(input.labels ?? {}) },
		annotations: input.annotations,
		schedule: input.schedule,
		concurrencyPolicy: input.concurrencyPolicy,
		successfulJobsHistoryLimit: input.successfulJobsHistoryLimit,
		failedJobsHistoryLimit: input.failedJobsHistoryLimit,
		jobTemplate: {
			spec: {
				template: {
					metadata: { labels: selectorLabels },
					spec: {
						containers: input.containers,
						volumes: input.volumes,
						imagePullSecrets: input.imagePullSecrets,
						serviceAccountName: input.name,
						restartPolicy: input.restartPolicy ?? "OnFailure",
					},
				},
			},
		},
	});

	return M.make((ctx) =>
		Effect.all([sa.render(ctx), cronJob.render(ctx)], { concurrency: "unbounded" }),
	);
};
