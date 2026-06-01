import { AppOfApps } from "@konfig.ts/argocd";
import { Effect, Layer } from "effect";
import { cluster } from "../cluster";
import { defineApi } from "../modules/api";
import { defineImagePulls } from "../modules/image-pulls";
import { definePostgres } from "../modules/postgres";
import { defineSopsOperator } from "../modules/sops-operator";
import { defineWorker } from "../modules/worker";

/**
 * Production env composition.
 *
 * Yields every module configured for prod and composes via
 * `AppOfApps.make`. The interesting part is the `Layer.provideMerge`
 * chain at the bottom — it threads the providers (sopsOperator,
 * imagePulls, postgres) ahead of the consumers (api, worker).
 *
 * If any consumer's Dep.Secret/Dep.Namespace need is unprovided, the
 * type system flags it at `AppOfApps.entrypoint`. See `broken.ts` for
 * a worked example.
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
		Layer.mergeAll(
			api.layer,
			worker.layer,
		).pipe(
			Layer.provideMerge(
				Layer.mergeAll(sopsOperator.layer, imagePulls.layer, postgres.layer),
			),
		),
	),
);

export default AppOfApps.entrypoint(program);
