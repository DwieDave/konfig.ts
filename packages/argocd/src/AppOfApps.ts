
import type { AnyRenderError, Manifest as CoreManifest } from "@konfig.ts/core";
import { Effect, Layer } from "effect";
import type { Application, ApplicationHandle } from "./Application";

export interface AppOfAppsTarget {
	readonly repoURL: string;
	readonly branch: string;
	readonly rootPath: string;
	readonly controllerNamespace?: string;
}

export interface AppOfAppsDefaults {
	readonly destination?: {
		readonly server?: string;
		readonly namespace?: string;
	};
	readonly syncPolicy?: import("./Application").SyncPolicy;
}

export interface AppOfAppsResult {
	readonly name: string;
	readonly target: AppOfAppsTarget;
	readonly defaults: AppOfAppsDefaults;
	readonly apps: ReadonlyArray<Application>;
}

export interface AppOfAppsMakeOptions {
	readonly name?: string;
	readonly target: AppOfAppsTarget;
	readonly defaults: AppOfAppsDefaults;
	readonly apps: ReadonlyArray<Application>;
}

export const make = (opts: AppOfAppsMakeOptions): AppOfAppsResult => ({
	name: opts.name ?? "apps",
	target: opts.target,
	defaults: opts.defaults,
	apps: opts.apps,
});

export const entrypoint = <A, E, R extends CoreManifest.RenderServices = never>(
	program: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => program;

// `any` in the AnyHandle upper bound: Effect's Layer is contravariant in
// its first parameter and the wrapper here is invariant at the inference
// site. `unknown` rejects concrete subtypes; `any` is bivariant — the
// canonical "any handle" upper bound.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandle = ApplicationHandle<any, any, any>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OutOfHandle<H> = H extends ApplicationHandle<any, infer Out, any> ? Out : never;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InOfHandle<H> = H extends ApplicationHandle<any, any, infer In> ? In : never;

// Left-fold `Layer.provideMerge` over the tuple: each successive module's
// remaining In is the In it declared, minus every prior module's Out. This
// mirrors the runtime construction (`fromModules` reduces with provideMerge
// in tuple order), so the residual surfaces real wiring errors — including
// "you listed a consumer before its provider".
type FoldResidualIn<
	T extends ReadonlyArray<AnyHandle>,
	AccIn,
	AccOut,
> = T extends readonly [infer H, ...infer Rest]
	? H extends AnyHandle
		? Rest extends ReadonlyArray<AnyHandle>
			? FoldResidualIn<
					Rest,
					AccIn | Exclude<InOfHandle<H>, AccOut>,
					AccOut | OutOfHandle<H>
				>
			: never
		: never
	: AccIn;

/**
 * After folding `Layer.provideMerge` over `Ms` in tuple order, the leftover
 * `RIn` channel — i.e., the Needs that no preceding module's Out satisfies.
 * `AppOfApps.entrypoint` requires `R extends Manifest.RenderServices`, so
 * any non-empty residual is a compile error at the entrypoint call site.
 */
export type ResidualIn<T extends ReadonlyArray<AnyHandle>> = FoldResidualIn<T, never, never>;

export interface FromModulesOptions<Ms extends ReadonlyArray<AnyHandle>> {
	readonly name?: string;
	readonly target: AppOfAppsTarget;
	readonly defaults: AppOfAppsDefaults;
	readonly modules: Ms;
}

/**
 * One-list composition for an app-of-apps.
 *
 * Yields each module's `Application` in tuple order, then constructs a wired
 * provider layer by left-folding `Layer.provideMerge`: each module receives
 * every prior module's Out as available services. The returned Effect's
 * R channel is the residual unmet Needs after that fold (`ResidualIn<Ms>`),
 * which `AppOfApps.entrypoint` rejects unless empty.
 *
 * **Order matters.** List providers before their consumers. The type system
 * catches mis-ordering at the `entrypoint` call: a consumer placed before
 * its provider leaves a `Dep.Need<...>` in the residual, which surfaces as
 * "is not assignable to RenderServices."
 *
 * Replaces the three-place mention of every module in env files
 * (`yield* mod` plus two `mergeAll`s threaded through `provideMerge`) with
 * a single ordered `modules` list.
 */
export const fromModules = <const Ms extends ReadonlyArray<AnyHandle>>(
	opts: FromModulesOptions<Ms>,
): Effect.Effect<
	AppOfAppsResult,
	AnyRenderError,
	ResidualIn<Ms> | CoreManifest.RenderServices
> => {
	const program = Effect.gen(function* () {
		const apps: Application[] = [];
		for (const mod of opts.modules) {
			const app = yield* mod;
			apps.push(app);
		}
		return make({
			name: opts.name,
			target: opts.target,
			defaults: opts.defaults,
			apps,
		});
	});

	type AnyLayer = Layer.Layer<never, AnyRenderError, never>;
	const wired = opts.modules.reduce<AnyLayer>(
		(acc, mod) => Layer.provideMerge(mod.layer as unknown as AnyLayer, acc) as unknown as AnyLayer,
		Layer.empty as unknown as AnyLayer,
	);

	return Effect.provide(program, wired) as unknown as Effect.Effect<
		AppOfAppsResult,
		AnyRenderError,
		ResidualIn<Ms> | CoreManifest.RenderServices
	>;
};
