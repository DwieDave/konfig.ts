import { AppOfApps } from "@konfig.ts/argocd";
import { cluster } from "../cluster";
import { defineApi } from "../modules/api";
import { defineApiBuild, defineWorkerBuild } from "../modules/builds";
import { defineFeatureFlags } from "../modules/feature-flags";
import { defineImagePulls } from "../modules/image-pulls";
import { definePostgres } from "../modules/postgres";
import { defineSopsOperator } from "../modules/sops-operator";
import { defineWorker } from "../modules/worker";

/**
 * Production env composition.
 *
 * Lists every module once, in dependency order (providers first). The
 * type-level dep check fires at `AppOfApps.entrypoint` for both
 * `Dep.Need<"Secret", _>` and `Dep.Need<"Image", _>` (the latter
 * shipped in round-2 prototype 8 — workloads `yield* Dep.Image(app)`,
 * the build modules `provides: Dep.provideImage(...)`).
 *
 * Forgetting `apiBuild` or `imagePulls` from the modules list surfaces
 * the friendlier hint:
 *   _konfig_unsatisfied: "Missing provider for Image \"api\"…"
 *
 * See `broken.ts` and `broken-image.ts` for worked examples.
 */

const branch = "main";
const rootPath = "./infra/k8s/manifests/prod";
const src = (name: string) => ({
	repoURL: cluster.repositoryUrl,
	targetRevision: branch,
	path: `${rootPath}/${name}`,
});

const sopsBase = "infra/secrets";

const sopsOperator = defineSopsOperator({ source: src("sops-operator") });
const imagePulls = defineImagePulls({ source: src("image-pulls"), sopsBase });
const featureFlags = defineFeatureFlags({ source: src("feature-flags") });
const postgres = definePostgres({ source: src("postgres"), storageGi: 20 });
const apiBuild = defineApiBuild({
	source: src("api-build"),
	registry: "ghcr.io/example",
	tag: "1.0.0",
});
const workerBuild = defineWorkerBuild({
	source: src("worker-build"),
	registry: "ghcr.io/example",
	tag: "1.0.0",
});
const api = defineApi({ source: src("api"), replicas: 2, sopsBase });
const worker = defineWorker({ source: src("worker"), replicas: 1, sopsBase });

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
