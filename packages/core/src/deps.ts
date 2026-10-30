import { Context, Layer, type Redacted } from "effect"
import { brand } from "./_cast"

declare const NeedBrand: unique symbol

export interface Need<K extends string, N extends string> {
  readonly [NeedBrand]: { readonly kind: K; readonly name: N }
}

export type Provide<K extends string, N extends string> = Need<K, N>

declare const SecretRefBrand: unique symbol
declare const ConfigMapRefBrand: unique symbol
declare const ServiceAccountRefBrand: unique symbol
declare const PvcRefBrand: unique symbol
declare const BuiltImageRefBrand: unique symbol

// Ns brands the owning namespace so pod-context consumers can reject cross-namespace refs
// at compile time, eliminating a runtime "secret not found across namespaces" failure.
export type SecretRef<
  N extends string,
  K extends string = string,
  Ns extends string = string
> = string & {
  readonly [SecretRefBrand]: {
    readonly name: N
    readonly keys: K
    readonly namespace: Ns
  }
}

export type ConfigMapRef<N extends string, K extends string = string> = string & {
  readonly [ConfigMapRefBrand]: { readonly name: N; readonly keys: K }
}

export type ServiceAccountRef<N extends string> = string & {
  readonly [ServiceAccountRefBrand]: N
}

export type PvcRef<N extends string> = string & {
  readonly [PvcRefBrand]: N
}

// Runtime value is the full image ref string so K8s YAML serializes it directly; the phantom
// App brand ties it to the dep graph, catching a missing build module at entrypoint.
export type BuiltImageRef<App extends string> = string & {
  readonly [BuiltImageRefBrand]: App
}

export type BuiltImageRefApp<R> = R extends BuiltImageRef<infer App> ? App : never

export type SecretRefName<R> = R extends SecretRef<infer N, infer _K, infer _Ns> ? N : never

export type SecretRefKeys<R> = R extends SecretRef<infer _N, infer K, infer _Ns> ? K : never

export type SecretRefNamespace<R> = R extends SecretRef<infer _N, infer _K, infer Ns> ? Ns
  : never

export type ConfigMapRefName<R> = R extends ConfigMapRef<infer N, infer _K> ? N : never

export type ConfigMapRefKeys<R> = R extends ConfigMapRef<infer _N, infer K> ? K : never

const _service = <K extends string, N extends string, S>(input: {
  readonly kind: K
  readonly name: N
}): Context.Service<Need<K, N>, S> => Context.Service<Need<K, N>, S>(`${input.kind}:${input.name}`)

const _provide = <K extends string, N extends string, S>(input: {
  readonly kind: K
  readonly name: N
  readonly value: S
}): Layer.Layer<Provide<K, N>> => Layer.succeed(_service<K, N, S>(input))(input.value)

export const Secret = <
  N extends string,
  K extends string = string,
  Ns extends string = string
>(
  name: N
): Context.Service<Need<"Secret", N>, SecretRef<N, K, Ns>> =>
  _service<"Secret", N, SecretRef<N, K, Ns>>({ kind: "Secret", name })

export type SecretValuesRecord<K extends string> = {
  readonly [P in K]: Redacted.Redacted<string>
}

export const SecretValues = <N extends string, K extends string = string>(
  name: N
): Context.Service<Need<"SecretValues", N>, SecretValuesRecord<K>> =>
  _service<"SecretValues", N, SecretValuesRecord<K>>({ kind: "SecretValues", name })

export const Namespace = <N extends string>(name: N): Context.Service<Need<"Namespace", N>, N> =>
  _service<"Namespace", N, N>({ kind: "Namespace", name })

export const Application = <N extends string>(
  name: N
): Context.Service<Need<"Application", N>, N> => _service<"Application", N, N>({ kind: "Application", name })

export const App = <N extends string, S = unknown>(name: N): Context.Service<Need<"App", N>, S> =>
  _service<"App", N, S>({ kind: "App", name })

export const Image = <N extends string>(
  name: N
): Context.Service<Need<"Image", N>, BuiltImageRef<N>> =>
  _service<"Image", N, BuiltImageRef<N>>({ kind: "Image", name })

interface _ImageRefInput<App extends string> {
  readonly app: App
  readonly registry: string
  readonly tag: string
}

const _fullRef = <App extends string>(input: _ImageRefInput<App>): BuiltImageRef<App> =>
  brand<BuiltImageRef<App>>(`${input.registry}/${input.app}:${input.tag}`)

export const BuiltImageRef = {
  of: <const App extends string>(input: _ImageRefInput<App>): BuiltImageRef<App> => _fullRef(input)
}

export const provideImage = <const App extends string>(
  input: _ImageRefInput<App>
): Layer.Layer<Provide<"Image", App>> =>
  _provide<"Image", App, BuiltImageRef<App>>({ kind: "Image", name: input.app, value: _fullRef(input) })

export const provideSecret = <
  const N extends string,
  const K extends string = string,
  const Ns extends string = string
>(
  name: N
): Layer.Layer<Provide<"Secret", N>> =>
  _provide<"Secret", N, SecretRef<N, K, Ns>>({ kind: "Secret", name, value: brand<SecretRef<N, K, Ns>>(name) })

export const provideNamespace = <const N extends string>(
  name: N
): Layer.Layer<Provide<"Namespace", N>> => _provide<"Namespace", N, N>({ kind: "Namespace", name, value: name })

export const provideApplication = <const N extends string>(
  name: N
): Layer.Layer<Provide<"Application", N>> => _provide<"Application", N, N>({ kind: "Application", name, value: name })
