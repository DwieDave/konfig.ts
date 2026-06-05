import { Manifest, unsafeCoerce } from "@konfig.ts/core";
import { Effect } from "effect";
import type {
	CronJob as K8sCronJob,
	Deployment as K8sDeployment,
	Job as K8sJob,
	StatefulSet as K8sStatefulSet,
} from "./.generated/k8s-types";
import type { PodSpecInput } from "./container";
import type { Selector } from "./selector";

interface WorkloadMeta {
	readonly name: string;
	readonly namespace: string;
	readonly labels?: Readonly<Record<string, string>>;
	readonly annotations?: Readonly<Record<string, string>>;
}

interface SelectorAndTemplate {
	readonly selector: { readonly matchLabels: Readonly<Record<string, string>> };
	readonly template: {
		readonly metadata?: {
			readonly labels?: Readonly<Record<string, string>>;
			readonly annotations?: Readonly<Record<string, string>>;
		};
		readonly spec: PodSpecInput;
	};
}

export interface DeploymentInput extends WorkloadMeta, SelectorAndTemplate {
	readonly replicas?: number;
	readonly strategy?: unknown;
	readonly revisionHistoryLimit?: number;
	readonly progressDeadlineSeconds?: number;
	readonly minReadySeconds?: number;
}

/**
 * Deployment built from a `Selector`. The selector's labels become both
 * the Deployment's `spec.selector.matchLabels` and the pod template's
 * `metadata.labels` — coherent by construction. Drift between selector
 * and template (the classic "service has no endpoints" footgun) is
 * structurally impossible once both consume the same `podSet`.
 */
export interface DeploymentFromPodSetInput<L extends Readonly<Record<string, string>>> {
	readonly name: string;
	readonly namespace: string;
	readonly labels?: Readonly<Record<string, string>>;
	readonly annotations?: Readonly<Record<string, string>>;
	readonly podSet: Selector<L>;
	readonly replicas?: number;
	readonly template: {
		readonly metadata?: {
			readonly labels?: Readonly<Record<string, string>>;
			readonly annotations?: Readonly<Record<string, string>>;
		};
		readonly spec: PodSpecInput;
	};
	readonly strategy?: unknown;
	readonly revisionHistoryLimit?: number;
	readonly progressDeadlineSeconds?: number;
	readonly minReadySeconds?: number;
}

export const Deployment = {
	make: (input: DeploymentInput): Manifest.Manifest<K8sDeployment> => {
		const resource: K8sDeployment = {
			apiVersion: "apps/v1",
			kind: "Deployment",
			metadata: {
				name: input.name,
				namespace: input.namespace,
				labels: input.labels,
				annotations: input.annotations,
			},
			spec: {
				replicas: input.replicas,
				selector: input.selector,
				template: unsafeCoerce(input.template, "konfig PodSpecInput is structurally a K8s PodTemplateSpec body; brand-checked fields lower at construction"),
				strategy: unsafeCoerce(input.strategy, "DeploymentStrategy is escape-hatch unknown; lift to K8s type for serialization"),
				revisionHistoryLimit: input.revisionHistoryLimit,
				progressDeadlineSeconds: input.progressDeadlineSeconds,
				minReadySeconds: input.minReadySeconds,
			},
		};
		return Manifest.make<K8sDeployment>(() => Effect.succeed(resource));
	},
	fromPodSet: <L extends Readonly<Record<string, string>>>(
		input: DeploymentFromPodSetInput<L>,
	): Manifest.Manifest<K8sDeployment> =>
		Deployment.make({
			name: input.name,
			namespace: input.namespace,
			labels: input.labels,
			annotations: input.annotations,
			replicas: input.replicas,
			selector: { matchLabels: input.podSet.labels },
			template: {
				metadata: {
					labels: { ...input.podSet.labels, ...input.template.metadata?.labels },
					annotations: input.template.metadata?.annotations,
				},
				spec: input.template.spec,
			},
			strategy: input.strategy,
			revisionHistoryLimit: input.revisionHistoryLimit,
			progressDeadlineSeconds: input.progressDeadlineSeconds,
			minReadySeconds: input.minReadySeconds,
		}),
};

export interface StatefulSetInput extends WorkloadMeta, SelectorAndTemplate {
	readonly replicas?: number;
	readonly serviceName: string;
	readonly volumeClaimTemplates?: ReadonlyArray<unknown>;
	readonly podManagementPolicy?: string;
	readonly updateStrategy?: unknown;
}

export const StatefulSet = {
	make: (input: StatefulSetInput): Manifest.Manifest<K8sStatefulSet> => {
		const resource: K8sStatefulSet = {
			apiVersion: "apps/v1",
			kind: "StatefulSet",
			metadata: {
				name: input.name,
				namespace: input.namespace,
				labels: input.labels,
				annotations: input.annotations,
			},
			spec: {
				replicas: input.replicas,
				selector: input.selector,
				template: unsafeCoerce(input.template, "konfig PodSpecInput is structurally a K8s PodTemplateSpec body; brand-checked fields lower at construction"),
				serviceName: input.serviceName,
				volumeClaimTemplates: unsafeCoerce(input.volumeClaimTemplates, "StatefulSet volumeClaimTemplates is escape-hatch unknown; lift to K8s type"),
				podManagementPolicy: input.podManagementPolicy,
				updateStrategy: unsafeCoerce(input.updateStrategy, "StatefulSetUpdateStrategy is escape-hatch unknown"),
			},
		};
		return Manifest.make<K8sStatefulSet>(() => Effect.succeed(resource));
	},
};

export interface JobInput extends WorkloadMeta {
	readonly parallelism?: number;
	readonly completions?: number;
	readonly backoffLimit?: number;
	readonly activeDeadlineSeconds?: number;
	readonly ttlSecondsAfterFinished?: number;
	readonly suspend?: boolean;
	readonly template: {
		readonly metadata?: {
			readonly labels?: Readonly<Record<string, string>>;
			readonly annotations?: Readonly<Record<string, string>>;
		};
		readonly spec: PodSpecInput;
	};
}

export const Job = {
	make: (input: JobInput): Manifest.Manifest<K8sJob> => {
		const resource: K8sJob = {
			apiVersion: "batch/v1",
			kind: "Job",
			metadata: {
				name: input.name,
				namespace: input.namespace,
				labels: input.labels,
				annotations: input.annotations,
			},
			spec: {
				parallelism: input.parallelism,
				completions: input.completions,
				backoffLimit: input.backoffLimit,
				activeDeadlineSeconds: input.activeDeadlineSeconds,
				ttlSecondsAfterFinished: input.ttlSecondsAfterFinished,
				suspend: input.suspend,
				template: unsafeCoerce(input.template, "konfig PodSpecInput is structurally a K8s PodTemplateSpec body; brand-checked fields lower at construction"),
			},
		};
		return Manifest.make<K8sJob>(() => Effect.succeed(resource));
	},
};

export interface CronJobInput extends WorkloadMeta {
	readonly schedule: string;
	readonly concurrencyPolicy?: string;
	readonly successfulJobsHistoryLimit?: number;
	readonly failedJobsHistoryLimit?: number;
	readonly startingDeadlineSeconds?: number;
	readonly suspend?: boolean;
	readonly jobTemplate: {
		readonly metadata?: {
			readonly labels?: Readonly<Record<string, string>>;
			readonly annotations?: Readonly<Record<string, string>>;
		};
		readonly spec: {
			readonly template: {
				readonly metadata?: {
					readonly labels?: Readonly<Record<string, string>>;
					readonly annotations?: Readonly<Record<string, string>>;
				};
				readonly spec: PodSpecInput;
			};
			readonly backoffLimit?: number;
			readonly activeDeadlineSeconds?: number;
			readonly ttlSecondsAfterFinished?: number;
		};
	};
}

export const CronJob = {
	make: (input: CronJobInput): Manifest.Manifest<K8sCronJob> => {
		const resource: K8sCronJob = {
			apiVersion: "batch/v1",
			kind: "CronJob",
			metadata: {
				name: input.name,
				namespace: input.namespace,
				labels: input.labels,
				annotations: input.annotations,
			},
			spec: {
				schedule: input.schedule,
				concurrencyPolicy: input.concurrencyPolicy,
				successfulJobsHistoryLimit: input.successfulJobsHistoryLimit,
				failedJobsHistoryLimit: input.failedJobsHistoryLimit,
				startingDeadlineSeconds: input.startingDeadlineSeconds,
				suspend: input.suspend,
				jobTemplate: unsafeCoerce(input.jobTemplate, "konfig CronJob jobTemplate is structurally a K8s JobTemplateSpec body"),
			},
		};
		return Manifest.make<K8sCronJob>(() => Effect.succeed(resource));
	},
};
