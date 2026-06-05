import { Context, Layer, type Redacted } from "effect";
import { brand } from "./_cast";


declare const NeedBrand: unique symbol;
export interface Need<K extends string, N extends string> {
	readonly [NeedBrand]: { readonly kind: K; readonly name: N };
}
export type Provide<K extends string, N extends string> = Need<K, N>;

declare const SecretRefBrand: unique symbol;
declare const ConfigMapRefBrand: unique symbol;
declare const ServiceAccountRefBrand: unique symbol;
declare const PvcRefBrand: unique symbol;
declare const BuiltImageRefBrand: unique symbol;

/**
 * Nominal reference to a named Secret. `N` brands the secret's metadata
 * name; `K` (defaults to `string`, the unconstrained shape) brands the
 * union of declared data keys, so consumers like `secretEnv({ ref, key })`
 * can constrain `key` to keys that actually exist. Producers (e.g.
 * `Secret.make`, `Environment.bind` via `secretBind`) populate `K` from
 * the source-of-truth (`stringData` keys, `defineSecret({ env })` keys).
 */
export type SecretRef<N extends string, K extends string = string> = string & {
	readonly [SecretRefBrand]: { readonly name: N; readonly keys: K };
};
/**
 * Nominal reference to a named ConfigMap. `N` brands the metadata name;
 * `K` (defaults to `string`) brands the union of declared data keys, so
 * `configMapEnv({ ref, key })` can constrain `key` to keys that actually
 * exist on the map. Producers (e.g. `ConfigMap.make`) populate `K` from
 * the literal `data` (or `binaryData`) record keys.
 */
export type ConfigMapRef<N extends string, K extends string = string> = string & {
	readonly [ConfigMapRefBrand]: { readonly name: N; readonly keys: K };
};
export type ServiceAccountRef<N extends string> = string & {
	readonly [ServiceAccountRefBrand]: N;
};
export type PvcRef<N extends string> = string & {
	readonly [PvcRefBrand]: N;
};

/**
 * Nominal reference to a container image built in-tree. Runtime value
 * is the full image ref (`registry/app:tag`) — a string, so K8s YAML
 * serializes it directly. The phantom `App` brand carries the literal
 * app name and ties the ref to the dep graph via `Dep.Image`.
 *
 * Container `image` fields accept either a raw string (escape hatch
 * for vendor images: `ghcr.io/bitnami/postgresql:16.0.0`) or
 * `BuiltImageRef<App>`. The branded path catches a workload whose
 * build module is missing from the composition at `AppOfApps.entrypoint`.
 */
export type BuiltImageRef<App extends string> = string & {
	readonly [BuiltImageRefBrand]: App;
};

export type BuiltImageRefApp<R> = R extends BuiltImageRef<infer App> ? App : never;

export type SecretRefName<R> = R extends SecretRef<infer N, infer _K> ? N : never;
export type SecretRefKeys<R> = R extends SecretRef<infer _N, infer K> ? K : never;
export type ConfigMapRefName<R> = R extends ConfigMapRef<infer N, infer _K> ? N : never;
export type ConfigMapRefKeys<R> = R extends ConfigMapRef<infer _N, infer K> ? K : never;
export type PvcRefName<R> = R extends PvcRef<infer N> ? N : never;

export const Secret = <N extends string, K extends string = string>(
	name: N,
): Context.Service<Need<"Secret", N>, SecretRef<N, K>> =>
	Context.Service<Need<"Secret", N>, SecretRef<N, K>>(`Secret:${name}`);

export type SecretValuesRecord<K extends string> = {
	readonly [P in K]: Redacted.Redacted<string>;
};

export const SecretValues = <N extends string, K extends string = string>(
	name: N,
): Context.Service<Need<"SecretValues", N>, SecretValuesRecord<K>> =>
	Context.Service<Need<"SecretValues", N>, SecretValuesRecord<K>>(`SecretValues:${name}`);

export const ConfigMap = <N extends string, K extends string = string>(
	name: N,
): Context.Service<Need<"ConfigMap", N>, ConfigMapRef<N, K>> =>
	Context.Service<Need<"ConfigMap", N>, ConfigMapRef<N, K>>(`ConfigMap:${name}`);

export const Namespace = <N extends string>(name: N): Context.Service<Need<"Namespace", N>, N> =>
	Context.Service<Need<"Namespace", N>, N>(`Namespace:${name}`);

export const ServiceAccount = <N extends string>(
	name: N,
): Context.Service<Need<"ServiceAccount", N>, ServiceAccountRef<N>> =>
	Context.Service<Need<"ServiceAccount", N>, ServiceAccountRef<N>>(`ServiceAccount:${name}`);

export const Application = <N extends string>(
	name: N,
): Context.Service<Need<"Application", N>, N> =>
	Context.Service<Need<"Application", N>, N>(`Application:${name}`);

export const Pvc = <N extends string>(name: N): Context.Service<Need<"Pvc", N>, PvcRef<N>> =>
	Context.Service<Need<"Pvc", N>, PvcRef<N>>(`Pvc:${name}`);

export const App = <N extends string, S = unknown>(name: N): Context.Service<Need<"App", N>, S> =>
	Context.Service<Need<"App", N>, S>(`App:${name}`);

/**
 * Context.Service tag for a `BuiltImageRef<App>`. Modules that build an
 * image emit a Layer providing this service; modules that deploy a
 * container yield `Dep.Image(app)` to receive the typed ref. The
 * dep-graph residual at `AppOfApps.entrypoint` catches a missing
 * provider exactly like for `Dep.Secret`.
 */
export const Image = <N extends string>(
	name: N,
): Context.Service<Need<"Image", N>, BuiltImageRef<N>> =>
	Context.Service<Need<"Image", N>, BuiltImageRef<N>>(`Image:${name}`);

interface _ImageRefInput<App extends string> {
	readonly app: App;
	readonly registry: string;
	readonly tag: string;
}

const _fullRef = <App extends string>(input: _ImageRefInput<App>): BuiltImageRef<App> =>
	brand<BuiltImageRef<App>>(`${input.registry}/${input.app}:${input.tag}`);

/**
 * Construct a `BuiltImageRef<App>` from registry + app + tag. The
 * literal `app` is captured in the brand so a workload's
 * `Dep.Need<"Image", App>` matches only the build module that
 * provides this exact app.
 */
export const builtImageRef = <const App extends string>(
	input: _ImageRefInput<App>,
): BuiltImageRef<App> => _fullRef(input);

/**
 * Layer providing `Dep.Image(App)` for downstream consumers. Combine
 * with `Application.define` / `Module.fixedNs`'s `provides` slot to
 * have a build module surface its image to sibling workload modules
 * in the composition.
 */
export const provideImage = <const App extends string>(
	input: _ImageRefInput<App>,
): Layer.Layer<Provide<"Image", App>> => Layer.succeed(Image(input.app))(_fullRef(input));

export const provideSecret = <const N extends string, const K extends string = string>(
	name: N,
): Layer.Layer<Provide<"Secret", N>> =>
	Layer.succeed(Secret<N, K>(name))(brand<SecretRef<N, K>>(name));

export const provideConfigMap = <const N extends string, const K extends string = string>(
	name: N,
): Layer.Layer<Provide<"ConfigMap", N>> =>
	Layer.succeed(ConfigMap<N, K>(name))(brand<ConfigMapRef<N, K>>(name));

export const provideNamespace = <const N extends string>(
	name: N,
): Layer.Layer<Provide<"Namespace", N>> => Layer.succeed(Namespace(name))(name);

export const provideServiceAccount = <const N extends string>(
	name: N,
): Layer.Layer<Provide<"ServiceAccount", N>> =>
	Layer.succeed(ServiceAccount(name))(brand<ServiceAccountRef<N>>(name));

export const provideApplication = <const N extends string>(
	name: N,
): Layer.Layer<Provide<"Application", N>> => Layer.succeed(Application(name))(name);

export const providePvc = <const N extends string>(name: N): Layer.Layer<Provide<"Pvc", N>> =>
	Layer.succeed(Pvc(name))(brand<PvcRef<N>>(name));
