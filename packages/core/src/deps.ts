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

export type SecretRef<N extends string> = string & {
	readonly [SecretRefBrand]: N;
};
export type ConfigMapRef<N extends string> = string & {
	readonly [ConfigMapRefBrand]: N;
};
export type ServiceAccountRef<N extends string> = string & {
	readonly [ServiceAccountRefBrand]: N;
};
export type PvcRef<N extends string> = string & {
	readonly [PvcRefBrand]: N;
};

export type SecretRefName<R> = R extends SecretRef<infer N> ? N : never;
export type ConfigMapRefName<R> = R extends ConfigMapRef<infer N> ? N : never;
export type PvcRefName<R> = R extends PvcRef<infer N> ? N : never;

export const Secret = <N extends string>(
	name: N,
): Context.Service<Need<"Secret", N>, SecretRef<N>> =>
	Context.Service<Need<"Secret", N>, SecretRef<N>>(`Secret:${name}`);

export type SecretValuesRecord<K extends string> = {
	readonly [P in K]: Redacted.Redacted<string>;
};

export const SecretValues = <N extends string, K extends string = string>(
	name: N,
): Context.Service<Need<"SecretValues", N>, SecretValuesRecord<K>> =>
	Context.Service<Need<"SecretValues", N>, SecretValuesRecord<K>>(`SecretValues:${name}`);

export const ConfigMap = <N extends string>(
	name: N,
): Context.Service<Need<"ConfigMap", N>, ConfigMapRef<N>> =>
	Context.Service<Need<"ConfigMap", N>, ConfigMapRef<N>>(`ConfigMap:${name}`);

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

export const provideSecret = <const N extends string>(name: N): Layer.Layer<Provide<"Secret", N>> =>
	Layer.succeed(Secret(name))(brand<SecretRef<N>>(name));

export const provideConfigMap = <const N extends string>(
	name: N,
): Layer.Layer<Provide<"ConfigMap", N>> =>
	Layer.succeed(ConfigMap(name))(brand<ConfigMapRef<N>>(name));

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
