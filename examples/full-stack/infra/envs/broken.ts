/**
 * Worked example of the dep-graph type check catching a missing
 * provider at compile time.
 *
 * `api.build` does `yield* Dep.Secret("ghcr-pull")` and
 * `yield* Dep.Image("api")`, which adds those Needs to the resulting
 * `ApplicationHandle`'s environment slot. `AppOfApps.entrypoint`
 * requires every Need to be satisfied; with `imagePulls` and the
 * build modules omitted from `fromModules({ modules })`, the residual
 * surfaces as the friendlier hint on the input parameter:
 *
 *   Property '_konfig_unsatisfied' is missing in type ...
 *   but required in type '{ readonly _konfig_unsatisfied:
 *     "Missing provider for Secret \"ghcr-pull\". Add a module that
 *      provides it to AppOfApps.fromModules({ modules }), or check
 *      that providers come before consumers in the list."; }'
 *
 * Remove the `@ts-expect-error` below to see the actual error message.
 *
 * Not registered in konfig.json — this file exists purely as a typing
 * regression check (run `bun check`).
 */
import { AppOfApps } from "@konfig.ts/argocd";
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
	name: "api",
	source: src("api"),
	replicas: 1,
	sopsBase: "infra/secrets",
});
const worker = defineWorker({
	name: "worker",
	source: src("worker"),
	replicas: 1,
	sopsBase: "infra/secrets",
});

export default AppOfApps.entrypoint(
	// @ts-expect-error - _konfig_unsatisfied hint: missing providers for Secret "ghcr-pull" and Image "api" / "worker".
	AppOfApps.fromModules({
		target: { repoURL: cluster.repositoryUrl, branch, rootPath },
		defaults: {},
		modules: [api, worker],
	}),
);
