import { Application } from "@konfig.ts/argocd";
import { Dep, type Manifest } from "@konfig.ts/core";
import { Deployment, Environment } from "@konfig.ts/k8s";
import { Sops } from "@konfig.ts/sops";
import { workerEnv } from "@example/env-contracts";
import { Effect } from "effect";

export interface WorkerOptions {
	readonly source: Application.ArgoSource;
	readonly image: string;
	readonly replicas: number;
	readonly sopsBase: string;
}

/**
 * `apps/worker` workload module.
 *
 * Worker variant of the api: no Service, no ports. Reuses the same
 * `db-creds` SopsSecret as api — Environment.bind would emit the
 * SopsSecret manifest a second time, but the AppOfApps deduplicates
 * by (kind, namespace, name) at render time, so this is safe.
 *
 * Also demonstrates Dep.Secret consumption — like api, the worker
 * needs ghcr-pull mounted to pull its image.
 */
export const defineWorker = (opts: WorkerOptions) =>
	Application.define({
		name: "worker",
		namespace: "app",
		source: opts.source,
		build: Effect.gen(function* () {
			const ghcrRef = yield* Dep.Secret("ghcr-pull");

			const bound = Environment.bind({
				env: workerEnv,
				namespace: "app",
				secrets: {
					db: {
						backend: Sops.passthrough({
							file: `${opts.sopsBase}/SopsSecret-db-creds.yaml`,
						}),
					},
				},
			});

			const deployment = Deployment.make({
				name: "worker",
				namespace: "app",
				replicas: opts.replicas,
				selector: { matchLabels: { app: "worker" } },
				template: {
					metadata: { labels: { app: "worker" } },
					spec: {
						imagePullSecrets: [{ name: ghcrRef }],
						containers: [
							{
								name: "worker",
								image: opts.image,
								env: bound.envVars,
							},
						],
					},
				},
			});

			const out: ReadonlyArray<Manifest.Manifest<unknown>> = [
				...bound.manifests,
				deployment,
			];
			return out;
		}),
	});
