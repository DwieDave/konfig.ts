import { type AnyRenderError, Dep, unsafeCoerce } from "@konfig.ts/core";
import { type Context, Effect, Layer } from "effect";

/**
 * Mutate-attach a `.layer` field to an Effect Context.Tag — same pattern
 * `argocd/Application.ts:_attachLayerToTag` uses. A single unsafe cast
 * in the dep-graph machinery; lives here so the rest of Bundle stays
 * cast-free.
 */
const _attachLayerToTag = <Tag extends object, Out, Err, In>(
	tag: Tag,
	layer: Layer.Layer<Out, Err, In>,
): Tag & { readonly layer: Layer.Layer<Out, Err, In> } =>
	unsafeCoerce<Tag & { readonly layer: Layer.Layer<Out, Err, In> }>(
		Object.assign(tag, { layer }),
		"Effect Context.Tag is callable + extensible; Object.assign mutates in place and the cast widens the public type",
	);

export interface Bundle {
	readonly name: string;
	readonly namespace?: string;
	readonly manifests: ReadonlyArray<unknown>;
}

export interface BundleMakeOptions {
	readonly name: string;
	readonly namespace?: string;
	readonly manifests: ReadonlyArray<unknown>;
}

export const make = (opts: BundleMakeOptions): Bundle => ({
	name: opts.name,
	manifests: opts.manifests,
	...(opts.namespace !== undefined ? { namespace: opts.namespace } : {}),
});

/**
 * Handle returned by `Bundle.define`. Same yieldable-Context-Tag +
 * `.layer` pattern as argocd's `ApplicationHandle`; only the carried
 * value type differs (a plain `Bundle` with no argo source/syncPolicy).
 * `Dep.Need<"App", Name>` keys the dep graph by literal name so
 * sibling modules can `yield* bundleHandle` to consume it.
 */
export interface BundleHandle<Name extends string, Out, In>
	extends Context.Service<Dep.Need<"App", Name>, Bundle> {
	readonly layer: Layer.Layer<Out, AnyRenderError, In>;
}

/**
 * Resolves to `T` if it is a string literal (or template-literal pattern),
 * and to a branded error type if it is the bare `string` widening. Mirrors
 * `Application.LiteralName` in spirit — konfig's dep graph keys every
 * `Provide<"App", Name>` slot by literal `Name`, and a wrapper that lets
 * `Name` widen to `string` collapses every bundle into the same slot.
 */
export type LiteralName<T extends string> = string extends T
	? {
			readonly _konfig_error: "Bundle name/namespace must be a string literal. Make the wrapper generic (`<const Name extends string>`) and forward via `Bundle.LiteralName<Name>`.";
		}
	: T;

export interface BundleDefineOptions<
	Name extends string,
	Ns extends string,
	R,
	Extra,
> {
	readonly name: LiteralName<Name>;
	readonly namespace?: LiteralName<Ns>;
	readonly build:
		| Effect.Effect<ReadonlyArray<unknown>, AnyRenderError, R>
		| (() => ReadonlyArray<unknown>);
	readonly provides?: Layer.Layer<Extra>;
}

type _NsProvides<Ns extends string> = [Ns] extends [never]
	? never
	: Dep.Provide<"Namespace", Ns>;

type _NsExcludes<Ns extends string> = [Ns] extends [never]
	? never
	: Dep.Need<"Namespace", Ns>;

/**
 * Build a typed handle for a k8s bundle (group of manifests). Same
 * compile-time guarantees as `Application.define` minus argo's
 * `source: ArgoSource` / `syncPolicy` / sync-wave annotations:
 *  - the literal `Name` flows into `Dep.Provide<"App", Name>`,
 *  - the optional literal namespace flows into `Dep.Provide<"Namespace", Ns>`,
 *  - the build callback's `R` channel becomes the handle's `In` after
 *    subtracting what this bundle provides itself.
 *
 * Pair with `Bundle.fromModules` (Task 5) to compose multiple bundles
 * and have the dep-graph residual checked at `Bundle.entrypoint`.
 */
export const define = <
	const Name extends string,
	const Ns extends string = never,
	R = never,
	Extra = never,
>(
	opts: BundleDefineOptions<Name, Ns, R, Extra>,
): BundleHandle<
	Name,
	Dep.Provide<"App", Name> | _NsProvides<Ns> | Extra,
	Exclude<R, _NsExcludes<Ns> | Extra>
> => {
	const name = unsafeCoerce<Name>(
		opts.name,
		"LiteralName<Name> resolves to Name itself once the call typechecks",
	);
	const namespace =
		opts.namespace === undefined
			? undefined
			: unsafeCoerce<Ns>(
					opts.namespace,
					"LiteralName<Ns> resolves to Ns itself once the call typechecks",
				);

	const tag = Dep.App<Name, Bundle>(name);

	const nsLayer =
		namespace === undefined
			? Layer.empty
			: Layer.succeed(Dep.Namespace(namespace))(namespace);

	const internalLayer =
		opts.provides !== undefined ? Layer.mergeAll(nsLayer, opts.provides) : nsLayer;

	const buildEffect: Effect.Effect<ReadonlyArray<unknown>, AnyRenderError, R> =
		Effect.isEffect(opts.build) ? opts.build : Effect.sync(opts.build);

	const bundleLayer = Layer.effect(
		tag,
		buildEffect.pipe(
			Effect.map((manifests) =>
				make({
					name,
					...(namespace !== undefined ? { namespace } : {}),
					manifests,
				}),
			),
		),
	).pipe(Layer.provide(internalLayer));

	const layer =
		opts.provides !== undefined
			? Layer.mergeAll(bundleLayer, nsLayer, opts.provides)
			: Layer.mergeAll(bundleLayer, nsLayer);

	return unsafeCoerce<
		BundleHandle<
			Name,
			Dep.Provide<"App", Name> | _NsProvides<Ns> | Extra,
			Exclude<R, _NsExcludes<Ns> | Extra>
		>
	>(
		_attachLayerToTag(tag, layer),
		"narrow generic BundleHandle from the attachLayerToTag helper's loose Tag arg",
	);
};
