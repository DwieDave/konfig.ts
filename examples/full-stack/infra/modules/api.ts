import { Application } from "@konfig.ts/argocd";
import { Dep } from "@konfig.ts/core";
import { defineContainer, Environment, EnvVar, Port, Workload } from "@konfig.ts/k8s";
import { Sops } from "@konfig.ts/sops";
import { apiEnv } from "@example/env-contracts";
import { Effect } from "effect";
import { featureFlags } from "./feature-flags";

export interface ApiOptions {
	readonly source: Application.ArgoSource;
	readonly replicas: number;
	readonly sopsBase: string;
}

/**
 * `apps/api` workload module.
 *
 * Showcases the round-2 type-safety features end-to-end:
 *
 *   - `yield* Dep.Image("api")` resolves at composition time to a
 *     `BuiltImageRef<"api">` provided by `defineApiBuild` (modules/builds.ts).
 *     Forgetting to list `apiBuild` in `fromModules({ modules })` surfaces
 *     as a `_konfig_unsatisfied` hint at `AppOfApps.entrypoint`.
 *   - `defineContainer({ ports, env })` brands the port-name union
 *     ("http") and validates the env list for duplicate names. A typo'd
 *     `Port.ref(...)` on the readiness probe is a compile error; a
 *     duplicate env name surfaces a human-readable hint inline.
 *   - `EnvVar.fromSecretForPod({ podNamespace: "app", ref })` rejects refs
 *     whose namespace doesn't match — the db-creds Secret lives in "app",
 *     so a cross-namespace mistake fails at type-check time, not at pod
 *     startup with "secret not found".
 *   - `Environment.bind` still produces the same SopsSecret manifest +
 *     envVars; we splice in extras via `EnvVar.value` /
 *     `EnvVar.fromSecretForPod` / `EnvVar.fromConfigMap`, and the
 *     duplicate-detection guards us against shadowing one of bind's
 *     names by accident.
 */
export const defineApi = (opts: ApiOptions) =>
	Application.define({
		name: "api",
		namespace: "app",
		source: opts.source,
		build: Effect.gen(function* () {
			const ghcrRef = yield* Dep.Secret("ghcr-pull");
			const apiImage = yield* Dep.Image("api");

			const bound = Environment.bind({
				env: apiEnv,
				namespace: "app",
				secrets: {
					db: {
						backend: Sops.passthrough({
							file: `${opts.sopsBase}/SopsSecret-db-creds.yaml`,
						}),
					},
					s3: {
						backend: Sops.passthrough({
							file: `${opts.sopsBase}/SopsSecret-s3-creds.yaml`,
						}),
					},
					jwt: {
						backend: Sops.passthrough({
							file: `${opts.sopsBase}/SopsSecret-jwt-signing-key.yaml`,
						}),
					},
				},
			});

			const apiContainer = defineContainer({
				name: "api",
				image: apiImage,
				ports: [Port.make({ name: "http", containerPort: 8080 })],
				env: [
					...bound.envVars,
					// EnvVar.fromSecretForPod ties the db ref's namespace ("app")
					// to this pod's namespace. Crossing namespaces is a compile error.
					EnvVar.fromSecretForPod({
						name: "DATABASE_URL_PRIMARY",
						ref: bound.members.db.ref,
						key: "url",
						podNamespace: "app",
					}),
					// EnvVar.fromConfigMap with a typed ref: `key` is constrained
					// to the keys declared on featureFlags ("NEW_UI" | "BETA_DASHBOARD"
					// | "DARK_MODE"). Renaming a key in feature-flags.ts breaks
					// this call site at compile time.
					EnvVar.fromConfigMap({
						name: "FEATURE_NEW_UI",
						ref: featureFlags.ref,
						key: "NEW_UI",
					}),
					EnvVar.value({ name: "API_NAME", value: "api" }),
				],
				readinessProbe: {
					httpGet: { path: "/healthz", port: Port.ref("http") },
					periodSeconds: 5,
				},
			});

			const workload = Workload.web({
				name: "api",
				namespace: "app",
				deployment: {
					replicas: opts.replicas,
					imagePullSecrets: [{ name: ghcrRef }],
					containers: [apiContainer],
				},
				service: {
					ports: [{ port: 80, targetPort: Port.ref("http") }],
				},
			});

			return [...bound.manifests, workload];
		}),
	});
