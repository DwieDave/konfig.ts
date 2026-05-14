// Example 2 — Cross-application dependency check
//
// `Application.define` builds an ArgoCD Application as an Effect
// "module": its `build` Effect yields the `Dep.*` Keys the module
// needs (e.g. `Dep.Secret("ghcr-pull")`), and its `provides` Layer
// announces what it owns. Yielded Keys lift into the Effect's `R`;
// `Layer.succeed` (via `Dep.provideSecret(name)` and friends)
// discharges them.
//
// The payoff: when you compose Applications at env level, the
// TypeScript compiler verifies that every `Dep.*` yielded inside
// *any* sibling has been provided by *some* sibling. Forget the
// provider and you don't get a runtime crash — `AppOfApps.entrypoint`
// fails to typecheck, and the diagnostic names the missing
// kind+name. No hand-rolled DAG, no separate "validate" step.
//
// Run: bun examples/02-app-of-apps-deps.ts

import { Application, AppOfApps } from "@konfig.ts/argocd";
import { Dep } from "@konfig.ts/core";
import { Effect, Layer } from "effect";

// ── `infra` owns the cluster-wide pull-secret. ─────────────────────

const infra = Application.define({
	name: "infra",
	namespace: "infra",
	source: {
		repoURL: "ssh://git@github.com/example/infra.git",
		targetRevision: "main",
		path: "./apps/infra",
	},
	build: Effect.succeed([]),
	// `provideSecret` returns a Layer typed as
	// `Provide<"Secret", "ghcr-pull">`. Sibling apps yielding
	// `Dep.Secret("ghcr-pull")` are discharged by this provider.
	provides: Dep.provideSecret("ghcr-pull"),
});

// ── `web` consumes the pull-secret. ────────────────────────────────

const web = Application.define({
	name: "web",
	namespace: "prod",
	source: {
		repoURL: "ssh://git@github.com/example/infra.git",
		targetRevision: "main",
		path: "./apps/web",
	},
	build: Effect.gen(function* () {
		// Yielding the Key lifts `Need<"Secret", "ghcr-pull">` into
		// the build's R. The runtime value `ghcrRef` is the branded
		// SecretRef<"ghcr-pull"> — usable in imagePullSecrets etc.
		const ghcrRef = yield* Dep.Secret("ghcr-pull");
		void ghcrRef; // (pretend a Deployment uses it here)
		return [];
	}),
});

// ── Compose at env level. ──────────────────────────────────────────
//
// Merge `infra.layer` into `web.layer` so the consumer's `Need` is
// discharged by the provider's `Provide`. The merged Layer becomes
// the env's dep graph.

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

// `entrypoint` is a typed identity: it constrains R to
// `RenderServices = never`. If any `Dep.*` remains unsatisfied, this
// line fails to compile with TS naming the missing brand.
const checked = AppOfApps.entrypoint(program);

// ── What the type system rejects ───────────────────────────────────
//
// If we drop `infra` from the program and forget to merge its layer,
// `web`'s `yield* Dep.Secret("ghcr-pull")` leaves
// `Need<"Secret", "ghcr-pull">` in R. `entrypoint` then rejects
// with: "Type 'Need<"Secret", "ghcr-pull">' is not assignable to
// type 'never'."

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

// ── Run and print the resolved graph. ──────────────────────────────

Effect.runPromise(checked).then((result) => {
	process.stdout.write(`AppOfApps "${result.name}" — ${result.apps.length} apps\n`);
	for (const a of result.apps) {
		process.stdout.write(`  • ${a.namespace}/${a.name}\n`);
	}
});
