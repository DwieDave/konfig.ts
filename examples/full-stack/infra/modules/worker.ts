import { Application } from "@konfig.ts/argocd";
import { Dep, type Manifest, Module } from "@konfig.ts/core";
import { Container, Deployment, Environment } from "@konfig.ts/k8s";
import { Sops } from "@konfig.ts/sops";
import { workerEnv } from "@example/env-contracts";
import { Effect } from "effect";

export interface WorkerOpts {
	readonly replicas: number;
	readonly sopsBase: string;
}

/**
 * `apps/worker` workload module.
 *
 * Same round-2 typing flow as `api.ts`, minus the Service and ports
 * (the worker doesn't serve HTTP). Yields `Dep.Image("worker")` and
 * uses `Container` so duplicate env names in the worker's
 * spec would fail at compile time with the `_konfig_duplicate_env_names`
 * hint.
 *
 * Reuses the same `db-creds` SopsSecret as api — `Environment.bind`
 * would emit the SopsSecret manifest a second time, but the AppOfApps
 * deduplicates by (kind, namespace, name) at render time.
 */
export const defineWorker = Module.fixedNs({
	target: Application.target,
	namespace: "app",
	build: ({ name, namespace }, opts: WorkerOpts) =>
		Effect.gen(function* () {
			const ghcrRef = yield* Dep.Secret("ghcr-pull");
			const workerImage = yield* Dep.Image("worker");

			const bound = Environment.bind({
				env: workerEnv,
				namespace,
				secrets: {
					db: {
						backend: Sops.passthrough({
							file: `${opts.sopsBase}/SopsSecret-db-creds.yaml`,
						}),
					},
				},
			});

			const workerContainer = Container.define({
				name,
				image: workerImage,
				ports: [],
				env: bound.envVars,
			});

			const deployment = Deployment.make({
				name,
				namespace,
				replicas: opts.replicas,
				selector: { matchLabels: { app: name } },
				template: {
					metadata: { labels: { app: name } },
					spec: {
						imagePullSecrets: [{ name: ghcrRef }],
						containers: [workerContainer],
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
