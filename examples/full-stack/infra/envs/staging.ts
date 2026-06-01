/**
 * Staging composition. Same shape as prod, smaller replica counts.
 */
import { AppOfApps } from "@konfig.ts/argocd";
import { Effect, Layer } from "effect";
import { cluster } from "../cluster";
import { defineApi } from "../modules/api";
import { defineImagePulls } from "../modules/image-pulls";
import { definePostgres } from "../modules/postgres";
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
const postgres = definePostgres({ source: src("postgres"), storageGi: 5 });
const api = defineApi({
	source: src("api"),
	image: "ghcr.io/example/api:staging",
	replicas: 1,
	sopsBase,
});
const worker = defineWorker({
	source: src("worker"),
	image: "ghcr.io/example/worker:staging",
	replicas: 1,
	sopsBase,
});

const program = Effect.gen(function* () {
	const sopsApp = yield* sopsOperator;
	const pullsApp = yield* imagePulls;
	const pgApp = yield* postgres;
	const apiApp = yield* api;
	const workerApp = yield* worker;
	return AppOfApps.make({
		target: {
			repoURL: cluster.repositoryUrl,
			branch,
			rootPath,
		},
		defaults: { destination: { server: "https://kubernetes.default.svc" } },
		apps: [sopsApp, pullsApp, pgApp, apiApp, workerApp],
	});
}).pipe(
	Effect.provide(
		Layer.mergeAll(api.layer, worker.layer).pipe(
			Layer.provideMerge(
				Layer.mergeAll(sopsOperator.layer, imagePulls.layer, postgres.layer),
			),
		),
	),
);

export default AppOfApps.entrypoint(program);
