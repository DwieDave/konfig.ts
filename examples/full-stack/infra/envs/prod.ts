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

/**
 * Production env composition.
 *
 * Lists every module once, in dependency order (providers first). The
 * type-level dep check fires at `AppOfApps.entrypoint` for both
 * `Dep.Need<"Secret", _>` and `Dep.Need<"Image", _>` (workloads
 * `yield* Dep.Image(app)`, the build modules' `provides:
 * Dep.provideImage(...)`).
 *
 * Forgetting `apiBuild` or `imagePulls` from the modules list surfaces
 * the friendlier hint:
 *   _konfig_unsatisfied: "Missing provider for Image \"api\"…"
 *
 * See `broken.ts` for a worked example.
 */

const branch = "main";
const rootPath = "./infra/k8s/manifests/prod";
const src = (name: string) => ({
	repoURL: cluster.repositoryUrl,
	targetRevision: branch,
	path: `${rootPath}/${name}`,
});

const sopsBase = "infra/secrets";

const sopsOperator = defineSopsOperator({
	name: "sops-secrets-operator",
	source: src("sops-operator"),
});
const imagePulls = defineImagePulls({
	name: "image-pulls",
	source: src("image-pulls"),
	sopsBase,
});
const featureFlags = defineFeatureFlags({
	name: "feature-flags",
	source: src("feature-flags"),
});
const postgres = definePostgres({
	name: "postgres",
	source: src("postgres"),
	storageGi: 20,
});
const apiBuild = defineApiBuild({
	name: "api-build",
	source: src("api-build"),
	registry: "ghcr.io/example",
	tag: "1.0.0",
});
const workerBuild = defineWorkerBuild({
	name: "worker-build",
	source: src("worker-build"),
	registry: "ghcr.io/example",
	tag: "1.0.0",
});
const api = defineApi({
	name: "api",
	source: src("api"),
	replicas: 2,
	sopsBase,
});
const worker = defineWorker({
	name: "worker",
	source: src("worker"),
	replicas: 1,
	sopsBase,
});
const redisCache = defineRedisCache({ name: "redis-cache", source: src("redis-cache") });

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
