import { Application } from "@konfig.ts/argocd";
import { Helm } from "@konfig.ts/core";
import { Namespace } from "@konfig.ts/k8s";
import { Effect } from "effect";

export interface SopsOperatorOptions {
	readonly source: Application.ArgoSource;
}

/**
 * isindir/sops-secrets-operator — reconciles SopsSecret CRs into
 * native Secrets after decrypting with the operator's age key.
 *
 * Sync-wave -2 so it lands before the `secrets` app (-1) and the
 * postgres + app workloads (0). ArgoCD waves are a runtime ordering
 * mechanism — the static dep graph in envs/prod.ts is what catches
 * mis-composition at build time.
 */
export const defineSopsOperator = (opts: SopsOperatorOptions) =>
	Application.define({
		name: "sops-secrets-operator",
		namespace: "sops",
		source: opts.source,
		annotations: { "argocd.argoproj.io/sync-wave": "-2" },
		build: Effect.gen(function* () {
			const ns = Namespace.make({ name: "sops" });
			const release = Helm.release({
				repo: "https://isindir.github.io/sops-secrets-operator/",
				chart: "sops-secrets-operator",
				version: "0.19.0",
				digest: "sha256:90b7Q2hJ91EDrwNJv0vY6iIfztdhLnur0i5SBJCTjXQ",
				namespace: "sops",
				extraOpts: ["--include-crds"],
				values: {
					secretsAsFiles: [
						{ name: "age-key", mountPath: "/etc/sops-age", secretName: "sops-age" },
					],
					extraEnv: [{ name: "SOPS_AGE_KEY_FILE", value: "/etc/sops-age/age.key" }],
				},
			});
			return [ns, release];
		}),
	});
