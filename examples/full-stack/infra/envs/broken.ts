/**
 * Worked example of the dep-graph type check catching a missing
 * provider at compile time.
 *
 * `api.build` does `yield* Dep.Secret("ghcr-pull")`, which means its
 * `ApplicationHandle` carries `Need<"Secret", "ghcr-pull">` in its
 * environment slot. `AppOfApps.entrypoint` requires the program's
 * environment to be `never` — i.e. all deps satisfied.
 *
 * The composition below forgets to merge `imagePulls.layer`, so the
 * Need<"Secret", "ghcr-pull"> survives, and TypeScript flags it with
 * the @ts-expect-error below. Remove the @ts-expect-error to see the
 * actual error message.
 *
 * Not registered in konfig.json — this file exists purely as a typing
 * regression check (run `bun check`).
 */
import { AppOfApps } from "@konfig.ts/argocd";
import { Effect, Layer } from "effect";
import { cluster } from "../cluster";
import { defineApi } from "../modules/api";
import { defineWorker } from "../modules/worker";

const branch = "main";
const rootPath = "./infra/k8s/manifests/broken";
const src = (name: string) => ({
	repoURL: cluster.repositoryUrl,
	targetRevision: branch,
	path: `${rootPath}/${name}`,
});

const api = defineApi({
	source: src("api"),
	image: "ghcr.io/example/api:1.0.0",
	replicas: 1,
	sopsBase: "infra/secrets",
});
const worker = defineWorker({
	source: src("worker"),
	image: "ghcr.io/example/worker:1.0.0",
	replicas: 1,
	sopsBase: "infra/secrets",
});

const program = Effect.gen(function* () {
	const apiApp = yield* api;
	const workerApp = yield* worker;
	return AppOfApps.make({
		target: { repoURL: cluster.repositoryUrl, branch, rootPath },
		defaults: {},
		apps: [apiApp, workerApp],
	});
}).pipe(Effect.provide(Layer.mergeAll(api.layer, worker.layer)));

// @ts-expect-error Need<"Secret", "ghcr-pull"> is not assignable to never
export default AppOfApps.entrypoint(program);
