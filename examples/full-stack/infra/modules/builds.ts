import { Application } from "@konfig.ts/argocd";
import { Dep } from "@konfig.ts/core";
import { Effect } from "effect";

export interface BuildOptions {
	readonly source: Application.ArgoSource;
	readonly registry: string;
	readonly tag: string;
}

/**
 * Build module for the api container image.
 *
 * Exists purely as a dep-graph anchor — emits no Kubernetes manifests
 * (the build pipeline that produces the image is out of band, e.g. a
 * CI job triggered by `Application.build` metadata). What it does emit
 * is `Dep.Provide<"Image", "api">` via `provides`, so the api workload
 * module's `yield* Dep.Image("api")` resolves at composition time.
 *
 * Forgetting to add this to `fromModules({ modules })` surfaces as
 * `_konfig_unsatisfied: "Missing provider for Image \"api\"..."` at
 * `AppOfApps.entrypoint` — the same shape as a missing Secret provider.
 */
export const defineApiBuild = (opts: BuildOptions) =>
	Application.define({
		name: "api-build",
		namespace: "app",
		source: opts.source,
		provides: Dep.provideImage({ app: "api", registry: opts.registry, tag: opts.tag }),
		build: Effect.succeed([]),
	});

/**
 * Build module for the worker container image. Mirrors `defineApiBuild`.
 */
export const defineWorkerBuild = (opts: BuildOptions) =>
	Application.define({
		name: "worker-build",
		namespace: "app",
		source: opts.source,
		provides: Dep.provideImage({ app: "worker", registry: opts.registry, tag: opts.tag }),
		build: Effect.succeed([]),
	});
