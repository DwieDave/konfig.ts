import { Dep, Manifest, RenderError, type SecretRef } from "@konfig.ts/core"
import type { SecretEntry, SecretSource } from "@konfig.ts/env"
import { type Context, Effect, type Layer, Layer as L } from "effect"
import { resolveSource } from "./backend"
import type { SecretBackend } from "./backendKit"
import { EnvVar } from "./env"
import type { StringMap } from "./meta"
import { SecretRef as SecretRefValue } from "./refs"

interface _DeclaredSecretBase<N extends string, K extends string, Ns extends string> {
  readonly ref: SecretRef<N, K, Ns>
  readonly name: N
  readonly namespace: Ns
  readonly keys: ReadonlyArray<K>
  readonly envVars: ReadonlyArray<EnvVar>
  readonly manifest?: Manifest.Manifest<unknown>
  readonly refLayer: Layer.Layer<Dep.Provide<"Secret", N>>
}

// values/layer populated together iff a source was supplied; discriminated union prevents drift into "values but no layer".
type _SecretValuesFields<N extends string, K extends string> =
  | {
    readonly values: Context.Service<Dep.Need<"SecretValues", N>, Dep.SecretValuesRecord<K>>
    readonly layer: Layer.Layer<Dep.Provide<"SecretValues", N>, RenderError, Manifest.RenderServices>
  }
  | { readonly values?: undefined; readonly layer?: undefined }

export type DeclaredSecret<N extends string, K extends string, Ns extends string = string> =
  & _DeclaredSecretBase<N, K, Ns>
  & _SecretValuesFields<N, K>

interface BindSecretInput<
  N extends string,
  K extends string,
  E extends Readonly<Record<K, string>>,
  Ns extends string = string
> {
  readonly secret: SecretEntry<N, K, E>
  readonly backend?: SecretBackend<N, K>
  readonly source?: SecretSource<K, Manifest.RenderServices>
  readonly labels?: StringMap
  readonly annotations?: StringMap
  readonly namespace?: Ns
}

interface _ValuesLayerInput<N extends string, K extends string> {
  readonly name: N
  readonly namespace: string
  readonly source: SecretSource<K, Manifest.RenderServices>
}

const _buildValuesLayer = <N extends string, K extends string>(
  input: _ValuesLayerInput<N, K>
) => {
  const values = Dep.SecretValues<N, K>(input.name)

  const layer = L.effect(
    values,
    _cachedSource(input.source).pipe(
      Effect.flatMap((source) => resolveSource({ source, label: `SecretValues(${input.namespace}/${input.name})` }))
    )
  )

  return { values, layer }
}

const _cachedSource = <K extends string>(
  source: SecretSource<K, Manifest.RenderServices>
): Effect.Effect<SecretSource<K, Manifest.RenderServices>> =>
  Effect.cached(source.resolve).pipe(Effect.map((resolve) => ({ ...source, resolve })))

const _cachedManifest = <K extends string>(input: {
  readonly source: SecretSource<K, Manifest.RenderServices>
  readonly build: (source: SecretSource<K, Manifest.RenderServices>) => Manifest.Manifest<unknown>
}): Manifest.Manifest<unknown> =>
  Manifest.make((ctx) => _cachedSource(input.source).pipe(Effect.flatMap((source) => input.build(source).render(ctx))))

interface _EnvVarsInput<N extends string, K extends string, Ns extends string> {
  readonly secret: SecretEntry<N, K, Readonly<Record<K, string>>>
  readonly ref: SecretRef<N, K, Ns>
}

const _buildEnvVars = <N extends string, K extends string, Ns extends string>(
  { secret, ref }: _EnvVarsInput<N, K, Ns>
): EnvVar[] => secret.keys.map((key: K) => EnvVar.fromSecret({ name: secret.env[key], ref, key }))

// RequiresSource is erased to `boolean` here, so the compiler can't prove `source` is present; fail at runtime instead
// of letting `emit` read `undefined.resolve` and throw.
interface _MissingSourceInput {
  readonly backend: { readonly _tag: string }
  readonly name: string
  readonly namespace: string
}

const _missingSourceManifest = (input: _MissingSourceInput) =>
  Manifest.make<unknown>(() =>
    Effect.fail(
      new RenderError({
        message:
          `backend "${input.backend._tag}" requires a source but none was provided for secret "${input.namespace}/${input.name}"`
      })
    )
  )

interface _BackendManifestInput<N extends string, K extends string, E extends Readonly<Record<K, string>>> {
  readonly input: BindSecretInput<N, K, E, string>
  readonly source: SecretSource<K, Manifest.RenderServices> | undefined
  readonly namespace: string
}

const _backendManifest = <N extends string, K extends string, E extends Readonly<Record<K, string>>>(
  { input, source, namespace }: _BackendManifestInput<N, K, E>
): Manifest.Manifest<unknown> | undefined => {
  const { backend, secret } = input

  if (backend === undefined) return undefined

  if (backend.requiresSource && source === undefined) {
    return _missingSourceManifest({ backend, name: secret.name, namespace })
  }

  const emit = (resolved: SecretSource<K, Manifest.RenderServices> | undefined) =>
    backend.emit({
      name: secret.name,
      namespace,
      keys: secret.keys,
      labels: input.labels,
      annotations: input.annotations,
      source: resolved
    })

  return source === undefined ? emit(undefined) : _cachedManifest({ source, build: emit })
}

// Overloaded so the namespace type parameter `Ns` only narrows when an explicit
// `namespace` override is passed; without one, the fallback is the secret's own
// namespace, which is only known to be `string`.
export interface BindSecret {
  <
    N extends string,
    K extends string,
    E extends Readonly<Record<K, string>>,
    const Ns extends string
  >(
    input: BindSecretInput<N, K, E, Ns> & { readonly namespace: Ns }
  ): DeclaredSecret<N, K, Ns>
  <N extends string, K extends string, E extends Readonly<Record<K, string>>>(
    input: BindSecretInput<N, K, E, string>
  ): DeclaredSecret<N, K, string>
}

interface _DeclareInput<N extends string, K extends string, E extends Readonly<Record<K, string>>> {
  readonly input: BindSecretInput<N, K, E, string>
  readonly source: SecretSource<K, Manifest.RenderServices> | undefined
  readonly namespace: string
}

const _declareBase = <N extends string, K extends string, E extends Readonly<Record<K, string>>>(
  { input, source, namespace }: _DeclareInput<N, K, E>
): DeclaredSecret<N, K, string> => {
  const { secret } = input
  const ref = SecretRefValue.of<N, K, string>(secret.name)

  return {
    ref,
    name: secret.name,
    namespace,
    keys: secret.keys,
    envVars: _buildEnvVars({ secret, ref }),
    manifest: _backendManifest({ input, source, namespace }),
    refLayer: Dep.provideSecret(secret.name)
  }
}

export const bindSecret: BindSecret = <
  N extends string,
  K extends string,
  E extends Readonly<Record<K, string>>
>(
  input: BindSecretInput<N, K, E, string>
): DeclaredSecret<N, K, string> => {
  const source = input.source
  const namespace = input.namespace ?? input.secret.namespace
  const out = _declareBase({ input, source, namespace })

  return source === undefined
    ? out
    : { ...out, ..._buildValuesLayer({ name: input.secret.name, namespace, source }) }
}
