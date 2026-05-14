// `AppOfApps` — collects all Applications for an environment under
// one ArgoCD root.
//
// M9 dropped the type-level cross-app dep check (`CollectR/CollectP/
// MissingDeps/AssertSatisfied/RequiredDep/RecordToDeps`). The check
// now happens at the surrounding `Effect.runPromise(program)` call:
// the program yields each Application's effect, provides a merged
// Layer of all sibling providers, and TS rejects the run if any
// requirement remains in R. The diagnostic is "Type `SecretReq<"x">`
// is not assignable to type `never`" — produced by Effect's native R
// tracking, not by our hand-rolled algebra.

import type { Manifest as CoreManifest } from "@konfig.ts/core";
import type { Effect } from "effect";
import type { Application } from "./Application";

// ---- Target configuration (mirrors nixidy.target.*) ----

export interface AppOfAppsTarget {
	readonly repoURL: string;
	readonly branch: string;
	readonly rootPath: string;
	// Namespace where ArgoCD watches `Application` CRs. Becomes the
	// `metadata.namespace` of every emitted CR. Defaults to `argocd`.
	readonly controllerNamespace?: string;
}

// ---- Defaults applied to every child Application ----

export interface AppOfAppsDefaults {
	readonly destination?: {
		readonly server?: string;
		readonly namespace?: string;
	};
	// Default Argo `syncPolicy` for every app. Per-app `syncPolicy`
	// overrides this. Nixidy's default is
	// `{ automated: { prune: false, selfHeal: false } }` so the M4
	// smoke test enforces byte equivalence with that.
	readonly syncPolicy?: import("./Application").SyncPolicy;
}

// ---- Result ----

export interface AppOfAppsResult {
	// Directory under `target.rootPath/<envName>/` that holds the
	// emitted child Application CRs. Mirrors nixidy's
	// `nixidy.appOfApps.name` — prod uses "apps", staging uses
	// "apps-staging", etc. Defaults to "apps".
	readonly name: string;
	readonly target: AppOfAppsTarget;
	readonly defaults: AppOfAppsDefaults;
	readonly apps: ReadonlyArray<Application>;
}

// ---- Options ----

export interface AppOfAppsMakeOptions {
	readonly name?: string;
	readonly target: AppOfAppsTarget;
	readonly defaults: AppOfAppsDefaults;
	readonly apps: ReadonlyArray<Application>;
}

// Construct an AppOfApps. Pure data shaping — the cross-app dep check
// fires elsewhere via Effect's R.
export const make = (opts: AppOfAppsMakeOptions): AppOfAppsResult => ({
	name: opts.name ?? "apps",
	target: opts.target,
	defaults: opts.defaults,
	apps: opts.apps,
});

// Env entrypoint: assert at compile time that every yielded `Dep.*`
// requirement has been discharged by some module's `ownsLayer` or an
// explicit `Layer.succeed`. The constraint here permits exactly the
// platform `RenderServices` (`FileSystem`, `Path`,
// `ChildProcessSpawner`, `Scope`) — those are provided by the CLI's
// `BunServices.layer` at the runtime boundary. Anything else in R
// surfaces as a TS error at the call site naming the missing brand.
//
// Usage:
//   const program = Effect.gen(function* () { … });
//   export default AppOfApps.entrypoint(program);
//
// The function is a typed identity at runtime — value passes through
// unchanged. The whole point is the compile-time gate.
export const entrypoint = <A, E, R extends CoreManifest.RenderServices = never>(
	program: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => program;
