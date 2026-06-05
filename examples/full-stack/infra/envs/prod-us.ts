/**
 * Multi-cluster demo — US region overlay.
 *
 * Same module set as `prod.ts`, parameterized by the `us-east-1`
 * cluster overlay. Renders to `./infra/k8s/manifests/prod-us/us-east-1/`
 * via `konfig build prod-us --cluster=us-east-1`.
 */
import { AppOfApps } from "@konfig.ts/argocd";
import { cluster, clusters } from "../cluster";
import { defineApi } from "../modules/api";
import { defineApiBuild, defineWorkerBuild } from "../modules/builds";
import { defineFeatureFlags } from "../modules/feature-flags";
import { defineImagePulls } from "../modules/image-pulls";
import { definePostgres } from "../modules/postgres";
import { defineSopsOperator } from "../modules/sops-operator";
import { defineWorker } from "../modules/worker";

const branch = "main";
const rootPath = "./infra/k8s/manifests/prod-us";
const src = (name: string) => ({
	repoURL: cluster.repositoryUrl,
	targetRevision: branch,
	path: `${rootPath}/${name}`,
});

const sopsBase = "infra/secrets";
const overlay = clusters["us-east-1"]!;

const sopsOperator = defineSopsOperator({ source: src("sops-operator") });
const imagePulls = defineImagePulls({ source: src("image-pulls"), sopsBase });
const featureFlags = defineFeatureFlags({ source: src("feature-flags") });
const postgres = definePostgres({ source: src("postgres"), storageGi: 40 });
const apiBuild = defineApiBuild({
	source: src("api-build"),
	registry: overlay.registry,
	tag: "1.0.0",
});
const workerBuild = defineWorkerBuild({
	source: src("worker-build"),
	registry: overlay.registry,
	tag: "1.0.0",
});
const api = defineApi({ source: src("api"), replicas: 3, sopsBase });
const worker = defineWorker({ source: src("worker"), replicas: 2, sopsBase });

export default AppOfApps.entrypoint(
	AppOfApps.fromModules({
		target: { repoURL: cluster.repositoryUrl, branch, rootPath },
		defaults: { destination: { server: "https://kubernetes.default.svc" } },
		modules: [
			sopsOperator,
			imagePulls,
			featureFlags,
			postgres,
			apiBuild,
			workerBuild,
			api,
			worker,
		],
	}),
);
