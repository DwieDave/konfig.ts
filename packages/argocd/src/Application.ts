
import { coerce, type AnyRenderError, Dep } from "@konfig.ts/core";
import { type Context, Effect, Layer } from "effect";

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
	readonly name: Name;
	readonly namespace: Ns;
	readonly source: ArgoSource;
	readonly syncPolicy?: SyncPolicy;
	readonly buildMetadata?: BuildMetadata;
	readonly annotations?: Readonly<Record<string, string>>;
	readonly build: Effect.Effect<ReadonlyArray<unknown>, AnyRenderError, R>;
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

	const layer =
		opts.provides !== undefined
			? Layer.mergeAll(appLayer, ownsLayer, opts.provides)
			: Layer.mergeAll(appLayer, ownsLayer);

	return coerce<
		ApplicationHandle<
			Name,
			| Dep.Provide<"App", Name>
			| Dep.Provide<"Application", Name>
			| Dep.Provide<"Namespace", Ns>
			| Extra,
			Exclude<R, Dep.Need<"Application", Name> | Dep.Need<"Namespace", Ns> | Extra>
		>
	>(Object.assign(tag, { layer }));
};
