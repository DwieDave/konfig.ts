// `Application` — typed ArgoCD Application node.
//
// M9 dropped the `R`/`P` slots and the record-based dep algebra. Dep
// tracking now lives in Effect's R via yieldable `Dep.*` Keys
// (`@konfig.ts/core/deps`).
//
// Public API:
//   • `Application.make(opts)` — pure data constructor. Used inside a
//     module's `define({build})` callback to assemble the data record
//     once the manifests are computed.
//   • `Application.define({name, namespace, source, build, ...})` —
//     returns an `ApplicationHandle`: a `Context.Service` whose Shape
//     is `Application` (so `yield* handle` yields the data) with a
//     `.layer` property attached carrying the module's provides
//     (`Dep.Application(name)`, `Dep.Namespace(namespace)`, plus any
//     `provides` Layer the caller supplies for owned Secrets/etc).
//
// Composing modules at env level:
//
//   const web = webModule(...);
//   const worker = workerModule(...);
//   const program = Effect.gen(function* () {
//     const webApp = yield* web;        // : Application
//     const workerApp = yield* worker;  // : Application
//     return AppOfApps.make({ apps: [webApp, workerApp] });
//   }).pipe(Effect.provide(worker.layer.pipe(Layer.provideMerge(web.layer))));
//
// The cross-app dep check fires at `AppOfApps.entrypoint(program)` in
// the env file — any unsatisfied `Need<...>` surfaces as a TS error
// naming the missing kind+name.

import type { AnyRenderError } from "@konfig.ts/core";
import { Dep } from "@konfig.ts/core";
import { type Context, Effect, Layer } from "effect";

// Source configuration mirrors ArgoCD Application spec.source.
export interface ArgoSource {
	readonly repoURL: string;
	readonly targetRevision: string;
	readonly path: string;
}

// Sync policy mirrors ArgoCD Application spec.syncPolicy.
export interface SyncPolicy {
	readonly automated?: {
		readonly prune?: boolean;
		readonly selfHeal?: boolean;
		readonly allowEmpty?: boolean;
	};
	readonly syncOptions?: ReadonlyArray<string>;
	readonly retry?: {
		readonly limit?: number;
		readonly backoff?: {
			readonly duration?: string;
			readonly factor?: number;
			readonly maxDuration?: string;
		};
	};
}

// Optional build metadata used by `konfig services` (M4+).
export interface BuildMetadata {
	readonly source?: string;
	readonly dockerfile?: string;
	readonly imageName?: string;
	readonly image?: string;
	readonly cacheScope?: string;
	readonly extraTriggerPaths?: ReadonlyArray<string>;
	readonly preview?: {
		readonly deployment?: string;
		readonly url?: { readonly label?: string; readonly host?: string };
	};
}

// The Application node. Carries everything the renderer needs to emit
// the Application CR YAML.
export interface Application {
	readonly name: string;
	readonly namespace: string;
	readonly manifests: ReadonlyArray<unknown>;
	readonly source: ArgoSource;
	readonly syncPolicy?: SyncPolicy;
	readonly build?: BuildMetadata;
	readonly annotations?: Readonly<Record<string, string>>;
}

// Backwards-compat alias for code that still references `Any`.
export type Any = Application;

// ---- `make` — pure data constructor (used inside `define`'s build) ----

export interface ApplicationMakeOptions {
	readonly name: string;
	readonly namespace: string;
	readonly manifests: ReadonlyArray<unknown>;
	readonly source: ArgoSource;
	readonly syncPolicy?: SyncPolicy;
	readonly build?: BuildMetadata;
	readonly annotations?: Readonly<Record<string, string>>;
}

export const make = (opts: ApplicationMakeOptions): Application => ({
	name: opts.name,
	namespace: opts.namespace,
	manifests: opts.manifests,
	source: opts.source,
	...(opts.syncPolicy !== undefined ? { syncPolicy: opts.syncPolicy } : {}),
	...(opts.build !== undefined ? { build: opts.build } : {}),
	...(opts.annotations !== undefined ? { annotations: opts.annotations } : {}),
});

// ---- `define` — yieldable handle + provides Layer ----

// The handle: a `Context.Service` (so `yield* handle` works) carrying
// `Application` as its Shape, with a `.layer` property exposing this
// module's provides for env-level `Effect.provide`.
//
// `Out` is the union of types this app provides (`Dep.Provide<...>`
// brands); `In` is whatever the `build` Effect still requires after
// the module's own brands have been discharged internally.
export interface ApplicationHandle<Name extends string, Out, In>
	extends Context.Service<Dep.Need<"App", Name>, Application> {
	readonly layer: Layer.Layer<Out, AnyRenderError, In>;
}

export interface ApplicationDefineOptions<Name extends string, Ns extends string, R, Extra> {
	readonly name: Name;
	readonly namespace: Ns;
	readonly source: ArgoSource;
	readonly syncPolicy?: SyncPolicy;
	readonly buildMetadata?: BuildMetadata;
	readonly annotations?: Readonly<Record<string, string>>;
	// The build Effect produces the manifests array. Any `Dep.*` keys
	// yielded inside are lifted into `In` (after this module's own
	// brands are auto-discharged).
	readonly build: Effect.Effect<ReadonlyArray<unknown>, AnyRenderError, R>;
	// Extra provides (owned Secrets, ConfigMaps, ServiceAccounts).
	// Merged into the handle's `.layer` so siblings yielding those
	// Keys get discharged at env level.
	readonly provides?: Layer.Layer<Extra>;
}

export const define = <const Name extends string, const Ns extends string, R, Extra = never>(
	opts: ApplicationDefineOptions<Name, Ns, R, Extra>,
): ApplicationHandle<
	Name,
	| Dep.Provide<"App", Name>
	| Dep.Provide<"Application", Name>
	| Dep.Provide<"Namespace", Ns>
	| Extra,
	Exclude<R, Dep.Need<"Application", Name> | Dep.Need<"Namespace", Ns> | Extra>
> => {
	const tag = Dep.App<Name, Application>(opts.name);

	const ownsLayer = Layer.mergeAll(
		Layer.succeed(Dep.Application(opts.name))(opts.name),
		Layer.succeed(Dep.Namespace(opts.namespace))(opts.namespace),
	);

	// Layer pre-applied to the build: discharges this module's own
	// brands (Application + Namespace) AND any `provides` it owns
	// (Secrets/ConfigMaps it declares). Web's build yields
	// `Dep.Secret("ghcr-pull-secret")` for its own pull secret; that
	// req is satisfied here, so it doesn't leak into the env's R.
	const internalLayer =
		opts.provides !== undefined ? Layer.mergeAll(ownsLayer, opts.provides) : ownsLayer;

	const appLayer = Layer.effect(
		tag,
		opts.build.pipe(
			Effect.map((manifests) =>
				make({
					name: opts.name,
					namespace: opts.namespace,
					manifests,
					source: opts.source,
					syncPolicy: opts.syncPolicy,
					build: opts.buildMetadata,
					annotations: opts.annotations,
				}),
			),
		),
	).pipe(Layer.provide(internalLayer));

	// `.layer` exposes the same provides outward so SIBLINGS that yield
	// these names (e.g. plenty-stock-sync's `Dep.Secret("ghcr-pull-
	// secret")`) get their req discharged at env level via
	// `Layer.provideMerge`.
	const layer =
		opts.provides !== undefined
			? Layer.mergeAll(appLayer, ownsLayer, opts.provides)
			: Layer.mergeAll(appLayer, ownsLayer);

	// Layer's `Out` is annotated with `Provide<...>` (alias to `Need<...>`)
	// so hovers on `.layer` read as a provider surface; the tag's
	// Identifier stays `Need<"App", Name>` so yielding the handle still
	// reads as a requirement on the consumer side. Same brand, two
	// aliases — Effect's structural matching unifies them.
	//
	// `In` excludes BOTH the own brands AND `Extra` because the build
	// runs with `internalLayer` (own brands + provides) pre-applied —
	// so any Need yielded inside the build whose name is in Extra is
	// discharged here, not propagated to the env's R. Without
	// excluding Extra in the cast, TS treats it as opaque and the
	// reduction inside `Layer.provide` doesn't show up at the function
	// boundary.
	return Object.assign(tag, { layer }) as ApplicationHandle<
		Name,
		| Dep.Provide<"App", Name>
		| Dep.Provide<"Application", Name>
		| Dep.Provide<"Namespace", Ns>
		| Extra,
		Exclude<R, Dep.Need<"Application", Name> | Dep.Need<"Namespace", Ns> | Extra>
	>;
};
