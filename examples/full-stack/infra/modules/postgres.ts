import { Application } from "@konfig.ts/argocd";
import { Helm } from "@konfig.ts/core";
import { Namespace } from "@konfig.ts/k8s";
import { Effect } from "effect";

export interface PostgresOptions {
	readonly source: Application.ArgoSource;
	readonly storageGi: number;
}

/**
 * Bitnami Postgres via Helm. Demonstrates `Helm.release` — pulls the
 * chart at render time (cached under .konfig/helm-cache) and emits the
 * templated manifests as RawYaml stubs that the AppOfApps lifts.
 *
 * The `app` namespace it creates is implicitly provided via
 * `Application.define` (the `namespace` argument flows into the
 * Dep.Provide<"Namespace", "app"> output type), so consumer modules
 * declaring `namespace: "app"` won't double-create the Namespace.
 */
export const definePostgres = (opts: PostgresOptions) =>
	Application.define({
		name: "postgres",
		namespace: "app",
		source: opts.source,
		annotations: { "argocd.argoproj.io/sync-wave": "-1" },
		build: Effect.gen(function* () {
			const ns = Namespace.make({ name: "app" });

			const release = Helm.release({
				repo: "https://charts.bitnami.com/bitnami",
				chart: "postgresql",
				releaseName: "postgres",
				version: "16.0.0",
				digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
				namespace: "app",
				values: {
					auth: {
						database: "app",
						username: "app",
						existingSecret: "db-creds",
						secretKeys: {
							adminPasswordKey: "password",
							userPasswordKey: "password",
						},
					},
					primary: {
						persistence: {
							enabled: true,
							size: `${opts.storageGi}Gi`,
						},
					},
				},
			});

			return [ns, release];
		}),
	});
