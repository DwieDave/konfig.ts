
import { type AnyRenderError, type Dep, type Manifest as CoreManifest, unsafeCoerce } from "@konfig.ts/core";
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

/**
 * Per-Need template-literal hint shown when a dep-graph residual reaches
 * `entrypoint`. Each unmet `Dep.Need<K, V>` becomes a sentence naming
 * the missing kind, the missing value, and how to fix it. Variants for
 * non-Need residuals (unlikely in practice) fall back to a generic
 * pointer at the Effect Layer error.
 */
type UnsatisfiedHint<R> =
	R extends Dep.Need<infer K, infer V>
		? `Missing provider for ${K} "${V}". Add a module that provides it to AppOfApps.fromModules({ modules }), or check that providers come before consumers in the list.`
		: "Unsatisfied dep — see the Effect Layer error above.";

/**
 * When the residual `R` (i.e. anything in the program's R-channel that
 * isn't `Manifest.RenderServices`) is non-empty, intersect the input
 * program type with an object carrying a `_konfig_unsatisfied` property.
 * The program has no such property, so the call fails with a message
 * that names the missing dep — far friendlier than the raw
 * "Need<...> not assignable to never".
 */
type ResidualHintCheck<R> = [Exclude<R, CoreManifest.RenderServices>] extends [never]
	? unknown
	: {
			readonly _konfig_unsatisfied: UnsatisfiedHint<
				Exclude<R, CoreManifest.RenderServices>
			>;
		};

/**
 * Marks a fully-wired program as the entrypoint for an app-of-apps
 * render. Accepts only programs whose `R` channel reduces to
 * `Manifest.RenderServices`; otherwise the call fails at the
 * `program` argument with a `_konfig_unsatisfied` hint that names the
 * missing provider.
 */
export const entrypoint = <A, E, R>(
	program: Effect.Effect<A, E, R> & ResidualHintCheck<R>,
): Effect.Effect<A, E, R & CoreManifest.RenderServices> =>
	unsafeCoerce<Effect.Effect<A, E, R & CoreManifest.RenderServices>>(
		program,
		"ResidualHintCheck<R> intersection is a phantom; once the call typechecks, the runtime value is the original Effect",
	);

// `any` in the AnyHandle upper bound: Effect's Layer is contravariant in
// its first parameter and the wrapper here is invariant at the inference
// site. `unknown` rejects concrete subtypes; `any` is bivariant — the
// canonical "any handle" upper bound.
// oxlint-disable-next-line app/no-type-assertion
type AnyHandle = ApplicationHandle<any, any, any>;

// oxlint-disable-next-line app/no-type-assertion
type OutOfHandle<H> = H extends ApplicationHandle<any, infer Out, any> ? Out : never;
// oxlint-disable-next-line app/no-type-assertion
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
		(acc, mod) =>
			unsafeCoerce<AnyLayer>(
				Layer.provideMerge(
					unsafeCoerce<AnyLayer>(mod.layer, "ApplicationHandle.layer's variance is invariant from TS's view; the fold collapses to the residual at the type level only"),
					acc,
				),
				"Layer.provideMerge's return type is computed per-call; the fold collapses to AnyLayer for the running accumulator",
			),
		unsafeCoerce<AnyLayer>(Layer.empty, "Layer.empty has type Layer<never, never, never>; widening to AnyLayer is a no-op at runtime"),
	);

	return unsafeCoerce<Effect.Effect<AppOfAppsResult, AnyRenderError, ResidualIn<Ms> | CoreManifest.RenderServices>>(
		Effect.provide(program, wired),
		"the runtime Effect is the same; only the static R channel is narrowed to ResidualIn<Ms> by the fold-as-type",
	);
};
