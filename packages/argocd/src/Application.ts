
import { type AnyRenderError, Dep, unsafeCoerce } from "@konfig.ts/core";
import { type Context, Effect, Layer } from "effect";

/**
 * Mutate-attach a `layer` field to an Effect Context.Tag so that both
 * `yield* handle` (consume the service) and `handle.layer` (provide it
 * into a parent Layer) work off the same object reference. The single
 * unsafe cast in the dep-graph machinery lives here — keep it tested
 * (`Application.test.ts`) so Effect Context internals can move without
 * breaking every define* factory.
 */
const _attachLayerToTag = <
	Tag extends object,
	Out,
	Err,
	In,
>(
	tag: Tag,
	layer: Layer.Layer<Out, Err, In>,
): Tag & { readonly layer: Layer.Layer<Out, Err, In> } =>
	unsafeCoerce<Tag & { readonly layer: Layer.Layer<Out, Err, In> }>(
		Object.assign(tag, { layer }),
		"Effect Context.Tag is callable + extensible; Object.assign mutates in place and the cast widens the public type",
	);

export interface ArgoSource {
	readonly repoURL: string;
	readonly targetRevision: string;
	readonly path: string;
}

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

export interface Application {
	readonly name: string;
	readonly namespace: string;
	readonly manifests: ReadonlyArray<unknown>;
	readonly source: ArgoSource;
	readonly syncPolicy?: SyncPolicy;
	readonly build?: BuildMetadata;
	readonly annotations?: Readonly<Record<string, string>>;
}

export type Any = Application;

/**
 * Resolves to `T` if it is a string literal (or template-literal pattern),
 * and to a branded error type if it is the bare `string` widening. Use as
 * the field type on Application name/namespace slots and any wrapper that
 * forwards them.
 *
 * konfig's dependency graph keys every `Provide<"App", Name>` /
 * `Provide<"Application", Name>` slot by literal `Name`. A wrapper that
 * accidentally lets `Name` widen to `string` collapses every app into the
 * same slot and silently masks unmet deps. This makes that regression a
 * compile error at the call site — always fix the wrapper, never relax
 * the constraint.
 *
 * Forwarding pattern (no casts needed):
 *   export const defineX = <const Name extends string>(
 *     opts: { appName: Application.LiteralName<Name>; ... },
 *   ) => Application.define({ name: opts.appName, ... });
 */
export type LiteralName<T extends string> = string extends T
	? {
			readonly _konfig_error: "Application name/namespace must be a string literal. Make the wrapper generic (`<const Name extends string>`) and forward via `Application.LiteralName<Name>`.";
		}
	: T;

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

export interface ApplicationHandle<Name extends string, Out, In>
	extends Context.Service<Dep.Need<"App", Name>, Application> {
	readonly layer: Layer.Layer<Out, AnyRenderError, In>;
}

export interface ApplicationDefineOptions<Name extends string, Ns extends string, R, Extra> {
	readonly name: LiteralName<Name>;
	readonly namespace: LiteralName<Ns>;
	readonly source: ArgoSource;
	readonly syncPolicy?: SyncPolicy;
	readonly buildMetadata?: BuildMetadata;
	readonly annotations?: Readonly<Record<string, string>>;
	readonly build:
		| Effect.Effect<ReadonlyArray<unknown>, AnyRenderError, R>
		| (() => ReadonlyArray<unknown>);
	readonly provides?: Layer.Layer<Extra>;
}

export const define = <const Name extends string, const Ns extends string, R = never, Extra = never>(
	opts: ApplicationDefineOptions<Name, Ns, R, Extra>,
): ApplicationHandle<
	Name,
	| Dep.Provide<"App", Name>
	| Dep.Provide<"Application", Name>
	| Dep.Provide<"Namespace", Ns>
	| Extra,
	Exclude<R, Dep.Need<"Application", Name> | Dep.Need<"Namespace", Ns> | Extra>
> => {
	const name = opts.name as Name;
	const namespace = opts.namespace as Ns;
	const tag = Dep.App<Name, Application>(name);

	const ownsLayer = Layer.mergeAll(
		Layer.succeed(Dep.Application(name))(name),
		Layer.succeed(Dep.Namespace(namespace))(namespace),
	);

	const internalLayer =
		opts.provides !== undefined ? Layer.mergeAll(ownsLayer, opts.provides) : ownsLayer;

	const buildEffect: Effect.Effect<ReadonlyArray<unknown>, AnyRenderError, R> = Effect.isEffect(
		opts.build,
	)
		? opts.build
		: Effect.sync(opts.build);

	const appLayer = Layer.effect(
		tag,
		buildEffect.pipe(
			Effect.map((manifests) =>
				make({
					name,
					namespace,
					manifests,
					source: opts.source,
					syncPolicy: opts.syncPolicy,
					build: opts.buildMetadata,
					annotations: opts.annotations,
				}),
			),
		),
	).pipe(Layer.provide(internalLayer));

	const layer =
		opts.provides !== undefined
			? Layer.mergeAll(appLayer, ownsLayer, opts.provides)
			: Layer.mergeAll(appLayer, ownsLayer);

	return unsafeCoerce<ApplicationHandle<
		Name,
		| Dep.Provide<"App", Name>
		| Dep.Provide<"Application", Name>
		| Dep.Provide<"Namespace", Ns>
		| Extra,
		Exclude<R, Dep.Need<"Application", Name> | Dep.Need<"Namespace", Ns> | Extra>
	>>(_attachLayerToTag(tag, layer), "narrow generic ApplicationHandle from the attachLayerToTag helper's loose Tag arg");
};
