// M9 — parameterized `Context.Service` constructors for the five
// tracked kinds. Yielding a Key lifts its requirement into the
// surrounding gen function's `R`; `Effect.provide(Layer.succeed(Key,
// value))` discharges it.
//
// Replaces the custom `Manifest<A, R, P>` record algebra with
// Effect's native R-tracking. See
// `.docs/workflows/tsk-typesafe-k8s/m9-effect-port.md` for the design
// note.
//
// Implementation note: `Context.Service<Identifier, Shape>(key)`
// accepts the Identifier and Shape generics separately, returning a
// `Service<I, S>` which is BOTH a `Key<I, S>` (for `Layer.succeed`)
// AND a `Yieldable<…, S, never, I>` (for `yield*` in `Effect.gen`).
// No casts needed — the generics bind directly.
//
// Context lookup uses the `key` string for equality (see
// `references/effect-smol/packages/effect/src/Context.ts:makeUnsafe`),
// so two `Secret("foo")` calls return different objects with the same
// runtime key and resolve to the same provider value. No caching
// needed.

import { Context, Layer } from "effect";

// ---------- Single parameterized brand, two display aliases ----------
//
// `Need<Kind, Name>` and `Provide<Kind, Name>` are the SAME structural
// type — one branded interface — exposed under two names so the hover
// display matches the side of the dep graph you're reading:
//
//   • Module effects: R reads `Need<"Secret", "ghcr-pull-secret">` —
//     "this effect needs the Secret 'ghcr-pull-secret'".
//   • Module layers:  return type reads `Provide<"Secret", "ghcr-pull-
//     secret">` — "this layer provides the Secret 'ghcr-pull-secret'".
//
// Because they share the brand, Effect's `Effect.provide(layer)` still
// matches a `Layer<Provide<K, N>>` against a yielded `Need<K, N>`
// without any conversion — they're literally the same type to TS.

declare const NeedBrand: unique symbol;
export interface Need<K extends string, N extends string> {
	readonly [NeedBrand]: { readonly kind: K; readonly name: N };
}
export type Provide<K extends string, N extends string> = Need<K, N>;

// ---------- Branded refs (Shape returned when yielding) ----------
//
// Plain strings at runtime, with a phantom brand carrying the literal
// name. Branding rejects raw strings at FR-4.4 enforcement points
// (env vars, volumes, imagePullSecrets) while letting the runtime
// emit the bare name in YAML.

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

// ---------- The five Key constructors ----------

export const Secret = <N extends string>(
	name: N,
): Context.Service<Need<"Secret", N>, SecretRef<N>> =>
	Context.Service<Need<"Secret", N>, SecretRef<N>>(`Secret:${name}`);

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

// Per-module "this app exists at this tag" handle. The Identifier is
// `Need<"App", N>` — distinct N values produce distinct tags so two
// modules with the same Application name would collide (intentional —
// app names must be unique). The Shape is `unknown` here because each
// caller (the per-app module factory in `@konfig.ts/argocd`) refines it to
// `Application` via the Service generic.
export const App = <N extends string, S = unknown>(name: N): Context.Service<Need<"App", N>, S> =>
	Context.Service<Need<"App", N>, S>(`App:${name}`);

// ---------- Provider helpers ----------
//
// `provideSecret(name)` etc. return a Layer whose `Out` is typed with
// `Provide<...>` (alias to `Need<...>`). Modules use these inside
// `Application.define`'s `provides` to announce ownership of a
// resource — hovers on the resulting layer read uniformly as
// `Provide<"Kind", "name">` rather than mixing the alias used at the
// Service constructor (`Need<...>`).
//
// Same brand at runtime; the Provide alias only affects display.

// The branded `*Ref` types are phantom — at runtime they're plain
// strings — so the cast through `unknown` is the one safe place to
// inject the brand. Keeping it inside these helpers means callers
// never write a cast for their own owned resources.

export const provideSecret = <const N extends string>(name: N): Layer.Layer<Provide<"Secret", N>> =>
	Layer.succeed(Secret(name))(name as unknown as SecretRef<N>);

export const provideConfigMap = <const N extends string>(
	name: N,
): Layer.Layer<Provide<"ConfigMap", N>> =>
	Layer.succeed(ConfigMap(name))(name as unknown as ConfigMapRef<N>);

export const provideNamespace = <const N extends string>(
	name: N,
): Layer.Layer<Provide<"Namespace", N>> => Layer.succeed(Namespace(name))(name);

export const provideServiceAccount = <const N extends string>(
	name: N,
): Layer.Layer<Provide<"ServiceAccount", N>> =>
	Layer.succeed(ServiceAccount(name))(name as unknown as ServiceAccountRef<N>);

export const provideApplication = <const N extends string>(
	name: N,
): Layer.Layer<Provide<"Application", N>> => Layer.succeed(Application(name))(name);

export const providePvc = <const N extends string>(name: N): Layer.Layer<Provide<"Pvc", N>> =>
	Layer.succeed(Pvc(name))(name as unknown as PvcRef<N>);
