import { AppOfApps } from "@konfig.ts/argocd";
import { cluster } from "../cluster";
import { defineApi } from "../modules/api";
import { defineImagePulls } from "../modules/image-pulls";
import { definePostgres } from "../modules/postgres";
import { defineSopsOperator } from "../modules/sops-operator";
import { defineWorker } from "../modules/worker";

/**
 * Production env composition.
 *
 * Lists every module once, in dependency order (providers first). The
 * type-level dep check still fires at `AppOfApps.entrypoint`: forgetting
 * `imagePulls` — or putting `api`/`worker` before it — leaves
 * `Need<"Secret", "ghcr-pull">` in the residual and fails to compile.
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

const sopsOperator = defineSopsOperator({ source: src("sops-operator") });
const imagePulls = defineImagePulls({ source: src("image-pulls"), sopsBase });
const postgres = definePostgres({ source: src("postgres"), storageGi: 20 });
const api = defineApi({
	source: src("api"),
	image: "ghcr.io/example/api:1.0.0",
	replicas: 2,
	sopsBase,
});
const worker = defineWorker({
	source: src("worker"),
	image: "ghcr.io/example/worker:1.0.0",
	replicas: 1,
	sopsBase,
});

export default AppOfApps.entrypoint(
	AppOfApps.fromModules({
		target: { repoURL: cluster.repositoryUrl, branch, rootPath },
		defaults: { destination: { server: "https://kubernetes.default.svc" } },
		modules: [sopsOperator, imagePulls, postgres, api, worker],
	}),
);
