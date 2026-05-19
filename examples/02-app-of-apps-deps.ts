
import { Application, AppOfApps } from "@konfig.ts/argocd";
import { Dep } from "@konfig.ts/core";
import { Effect, Layer } from "effect";

const infra = Application.define({
	name: "infra",
	namespace: "infra",
	source: {
		repoURL: "ssh://git@github.com/example/infra.git",
		targetRevision: "main",
		path: "./apps/infra",
	},
	build: Effect.succeed([]),
	provides: Dep.provideSecret("ghcr-pull"),
});

const web = Application.define({
	name: "web",
	namespace: "prod",
	source: {
		repoURL: "ssh://git@github.com/example/infra.git",
		targetRevision: "main",
		path: "./apps/web",
	},
	build: Effect.gen(function* () {
		const ghcrRef = yield* Dep.Secret("ghcr-pull");
		void ghcrRef;
		return [];
	}),
});

const program = Effect.gen(function* () {
	const infraApp = yield* infra;
	const webApp = yield* web;
	return AppOfApps.make({
		target: {
			repoURL: "ssh://git@github.com/example/infra.git",
			branch: "main",
			rootPath: "./apps",
		},
		defaults: { destination: { server: "https://kubernetes.default.svc" } },
		apps: [infraApp, webApp],
	});
}).pipe(Effect.provide(web.layer.pipe(Layer.provideMerge(infra.layer))));

const checked = AppOfApps.entrypoint(program);

const broken = Effect.gen(function* () {
	const webApp = yield* web;
	return AppOfApps.make({
		target: {
			repoURL: "ssh://git@github.com/example/infra.git",
			branch: "main",
			rootPath: "./apps",
		},
		defaults: {},
		apps: [webApp],
	});
}).pipe(Effect.provide(web.layer));

// @ts-expect-error  Need<"Secret", "ghcr-pull"> is not assignable to never
AppOfApps.entrypoint(broken);

Effect.runPromise(checked).then((result) => {
	process.stdout.write(`AppOfApps "${result.name}" — ${result.apps.length} apps\n`);
	for (const a of result.apps) {
		process.stdout.write(`  • ${a.namespace}/${a.name}\n`);
	}
});
