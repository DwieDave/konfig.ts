import { type AnyRenderError } from "@konfig.ts/core";
import { Effect, type Layer } from "effect";
import {
	type ArgoSource,
	type BuildMetadata,
	define,
	type LiteralName,
	type SyncPolicy,
} from "./Application";

/**
 * Context passed to a module's `build` callback. Carries the per-instance
 * identity (the chosen `name` plus the module's `namespace`) so the build
 * can stamp them onto manifests without re-receiving them via `opts`.
 */
export interface ModuleBuildContext<Ns extends string = string> {
	readonly name: string;
	readonly namespace: Ns;
}

/**
 * Allowed return shapes from a module `build` callback:
 *  - an `Effect` (use this when the build reads from `Layer`s, files, etc.)
 *  - a plain `ReadonlyArray<unknown>` (use this for pure synchronous builds).
 *
 * `Module.fixedNs` / `Module.dynamicNs` lift the array form into an `Effect`
 * internally — wrapper authors don't need to wrap themselves.
 */
export type ModuleBuildResult<R = never> =
	| Effect.Effect<ReadonlyArray<unknown>, AnyRenderError, R>
	| ReadonlyArray<unknown>;

const liftBuild = <R>(
	result: ModuleBuildResult<R>,
): Effect.Effect<ReadonlyArray<unknown>, AnyRenderError, R> =>
	Effect.isEffect(result) ? result : Effect.succeed(result);

export interface FixedNsModuleConfig<Ns extends string, Opts, R, Extra> {
	/** Static namespace baked into the module's identity. */
	readonly namespace: Ns;
	readonly syncPolicy?: SyncPolicy;
	readonly annotations?: Readonly<Record<string, string>>;
	readonly buildMetadata?: BuildMetadata;
	readonly provides?: Layer.Layer<Extra>;
	readonly build: (ctx: ModuleBuildContext<Ns>, opts: Opts) => ModuleBuildResult<R>;
}

/**
 * Build a typed wrapper for a module whose namespace is part of its
 * identity (e.g. `cert-manager` always installs into the
 * `cert-manager` namespace).
 *
 * The returned function accepts:
 *  - `name`: the ArgoCD Application metadata.name (must be a string literal)
 *  - `source`: the Argo source the Application syncs from
 *  - any module-specific options inferred from the `build` callback's
 *    second parameter type.
 *
 * Callers never write a generic decl — `name` flows through to the
 * resulting `ApplicationHandle<Name, ...>` as a literal, preserving
 * konfig's dependency-graph tracking.
 *
 * ```ts
 * export const defineSopsOperator = Module.fixedNs({
 *   namespace: "sops",
 *   annotations: SyncWave(-1),
 *   build: ({ namespace }, opts: { resources?: ResourceLimits }) => [
 *     Namespace.make({ name: namespace }),
 *     Helm.release({ ... }),
 *   ],
 * });
 *
 * // call-site (no generics):
 * const sops = defineSopsOperator({
 *   name: "sops-secrets-operator",
 *   source: src("sops-secrets-operator"),
 * });
 * ```
 */
export const fixedNs = <const Ns extends string, Opts = Record<never, never>, R = never, Extra = never>(
	config: FixedNsModuleConfig<Ns, Opts, R, Extra>,
) => {
	const { namespace, syncPolicy, annotations, buildMetadata, provides, build } = config;
	return <const Name extends string>(
		args: { readonly name: LiteralName<Name>; readonly source: ArgoSource } & Opts,
	) => {
		const { name, source, ...rest } = args as unknown as {
			name: LiteralName<Name>;
			source: ArgoSource;
		} & Opts;
		return define<Name, Ns, R, Extra>({
			name,
			namespace: namespace as LiteralName<Ns>,
			source,
			...(syncPolicy !== undefined ? { syncPolicy } : {}),
			...(annotations !== undefined ? { annotations } : {}),
			...(buildMetadata !== undefined ? { buildMetadata } : {}),
			...(provides !== undefined ? { provides } : {}),
			build: liftBuild(build({ name: name as Name, namespace }, rest as Opts)),
		});
	};
};

export interface DynamicNsModuleConfig<Opts, R, Extra> {
	readonly syncPolicy?: SyncPolicy;
	readonly annotations?: Readonly<Record<string, string>>;
	readonly buildMetadata?: BuildMetadata;
	readonly provides?: Layer.Layer<Extra>;
	readonly build: (ctx: ModuleBuildContext, opts: Opts) => ModuleBuildResult<R>;
}

/**
 * Build a typed wrapper for a module whose namespace is chosen per
 * instance (e.g. an `api` module that ships into different namespaces
 * per env).
 *
 * The returned function accepts:
 *  - `name`: the ArgoCD Application metadata.name (string literal)
 *  - `namespace`: the target namespace (string literal)
 *  - `source`: the Argo source
 *  - any module-specific options inferred from the `build` callback.
 *
 * ```ts
 * export const defineApi = Module.dynamicNs({
 *   annotations: SyncWave(1),
 *   build: ({ name, namespace }, opts: ApiInstanceOpts) => Effect.gen(function*() {
 *     return [ ... manifests built using opts.image, opts.host, ... ];
 *   }),
 * });
 *
 * // call-site:
 * const api = defineApi({
 *   name: "api",
 *   namespace: "prod",
 *   source: src("api"),
 *   image: e.api,
 *   host: cluster.domain,
 * });
 * ```
 */
export const dynamicNs = <Opts = Record<never, never>, R = never, Extra = never>(
	config: DynamicNsModuleConfig<Opts, R, Extra>,
) => {
	const { syncPolicy, annotations, buildMetadata, provides, build } = config;
	return <const Name extends string, const Ns extends string>(
		args: {
			readonly name: LiteralName<Name>;
			readonly namespace: LiteralName<Ns>;
			readonly source: ArgoSource;
		} & Opts,
	) => {
		const { name, namespace, source, ...rest } = args as unknown as {
			name: LiteralName<Name>;
			namespace: LiteralName<Ns>;
			source: ArgoSource;
		} & Opts;
		return define<Name, Ns, R, Extra>({
			name,
			namespace,
			source,
			...(syncPolicy !== undefined ? { syncPolicy } : {}),
			...(annotations !== undefined ? { annotations } : {}),
			...(buildMetadata !== undefined ? { buildMetadata } : {}),
			...(provides !== undefined ? { provides } : {}),
			build: liftBuild(build({ name: name as Name, namespace: namespace as Ns }, rest as Opts)),
		});
	};
};
