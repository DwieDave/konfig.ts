/**
 * Multi-cluster demo — EU region overlay.
 *
 * Same module set as `prod.ts`, parameterized by the `eu-west-1`
 * cluster overlay (registry, ingress class, storage class, domain).
 * Render with `konfig build prod-eu --cluster=eu-west-1`. The CLI
 * threads `cluster` into `RenderContext.cluster`, and the build
 * directory becomes `./infra/k8s/manifests/prod-eu/eu-west-1/`.
 */
import { AppOfApps } from "@konfig.ts/argocd";
import { cluster, clusters } from "../cluster";
import { defineApi } from "../modules/api";
import { defineImagePulls } from "../modules/image-pulls";
import { definePostgres } from "../modules/postgres";
import { defineSopsOperator } from "../modules/sops-operator";
import { defineWorker } from "../modules/worker";

const branch = "main";
const rootPath = "./infra/k8s/manifests/prod-eu";
const src = (name: string) => ({
	repoURL: cluster.repositoryUrl,
	targetRevision: branch,
	path: `${rootPath}/${name}`,
});

const sopsBase = "infra/secrets";
const overlay = clusters["eu-west-1"]!;

const sopsOperator = defineSopsOperator({ source: src("sops-operator") });
const imagePulls = defineImagePulls({ source: src("image-pulls"), sopsBase });
const postgres = definePostgres({ source: src("postgres"), storageGi: 20 });
const api = defineApi({
	source: src("api"),
	image: `${overlay.registry}/api:1.0.0`,
	replicas: 2,
	sopsBase,
});
const worker = defineWorker({
	source: src("worker"),
	image: `${overlay.registry}/worker:1.0.0`,
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
