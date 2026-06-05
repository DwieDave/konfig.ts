/**
 * Staging composition. Same shape as prod, smaller replica counts and
 * a `staging` image tag.
 */
import { AppOfApps } from "@konfig.ts/argocd";
import { cluster } from "../cluster";
import { defineApi } from "../modules/api";
import { defineApiBuild, defineWorkerBuild } from "../modules/builds";
import { defineFeatureFlags } from "../modules/feature-flags";
import { defineImagePulls } from "../modules/image-pulls";
import { definePostgres } from "../modules/postgres";
import { defineRedisCache } from "../modules/redis-cache";
import { defineSopsOperator } from "../modules/sops-operator";
import { defineWorker } from "../modules/worker";

const branch = "main";
const rootPath = "./infra/k8s/manifests/staging";
const src = (name: string) => ({
	repoURL: cluster.repositoryUrl,
	targetRevision: branch,
	path: `${rootPath}/${name}`,
});
const sopsBase = "infra/secrets";

const sopsOperator = defineSopsOperator({ source: src("sops-operator") });
const imagePulls = defineImagePulls({ source: src("image-pulls"), sopsBase });
const featureFlags = defineFeatureFlags({ source: src("feature-flags") });
const postgres = definePostgres({ source: src("postgres"), storageGi: 5 });
const apiBuild = defineApiBuild({
	source: src("api-build"),
	registry: "ghcr.io/example",
	tag: "staging",
});
const workerBuild = defineWorkerBuild({
	source: src("worker-build"),
	registry: "ghcr.io/example",
	tag: "staging",
});
const api = defineApi({ source: src("api"), replicas: 1, sopsBase });
const worker = defineWorker({ source: src("worker"), replicas: 1, sopsBase });
const redisCache = defineRedisCache({ source: src("redis-cache") });

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
			redisCache,
			api,
			worker,
		],
	}),
);
