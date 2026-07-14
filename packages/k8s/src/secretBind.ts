import { Dep, Manifest, RenderError, type SecretRef, unsafeCoerce } from "@konfig.ts/core"
import type { SecretEntry, SecretSource } from "@konfig.ts/env"
import { type Context, Effect, type Layer, Layer as L } from "effect"
import type { SecretBackend } from "./backend"
import { EnvVar } from "./env"
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

// `values` and `layer` are populated together, iff a source was supplied
// at bind time — a discriminated union instead of two independent
// optionals so that can't drift into a "values but no layer" state.
type _SecretValuesFields<N extends string, K extends string> =
  | {
    readonly values: Context.Service<Dep.Need<"SecretValues", N>, Dep.SecretValuesRecord<K>>
    readonly layer: Layer.Layer<Dep.Provide<"SecretValues", N>, RenderError, Manifest.RenderServices>
  }
  | { readonly values?: undefined; readonly layer?: undefined }

export type DeclaredSecret<N extends string, K extends string, Ns extends string = string> =
  & _DeclaredSecretBase<N, K, Ns>
  & _SecretValuesFields<N, K>

export interface BindSecretInput<
  N extends string,
  K extends string,
  E extends Readonly<Record<K, string>>,
  Ns extends string = string
> {
  readonly secret: SecretEntry<N, K, E>
  readonly backend?: SecretBackend<N, K>
  readonly source?: SecretSource<K, Manifest.RenderServices>
  readonly labels?: Readonly<Record<string, string>>
  readonly annotations?: Readonly<Record<string, string>>
  /**
   * Override the contract's baked-in `namespace` for this bind. Useful
   * when the same `Secret` declaration is consumed across multiple
   * k8s namespaces (e.g. prod / staging / local of the same workload)
   * — the runtime read is namespace-independent, but each binding emits
   * its manifest into a different namespace.
   *
   * When passed as a string literal (via `Environment.bind`'s
   * `const namespace`), the literal flows into the ref's brand so
   * `secretEnvForPod` can enforce cross-namespace coherence.
   */
  readonly namespace?: Ns
}

interface _ValuesLayerInput<N extends string, K extends string> {
  readonly name: N
  readonly namespace: string
  readonly source: SecretSource<K, Manifest.RenderServices>
}

const _buildValuesLayer = <N extends string, K extends string>(
  input: _ValuesLayerInput<N, K>
): {
  readonly values: Context.Service<Dep.Need<"SecretValues", N>, Dep.SecretValuesRecord<K>>
  readonly layer: Layer.Layer<Dep.Provide<"SecretValues", N>, RenderError, Manifest.RenderServices>
} => {
  const values = Dep.SecretValues<N, K>(input.name)
  const layer = L.effect(
    values,
    input.source.resolve.pipe(
      Effect.mapError(
        (cause) =>
          new RenderError({
            message: `SecretValues(${input.namespace}/${input.name}): source failed for key "${cause.key}"`,
            cause
          })
      )
    )
  )
  return { values, layer }
}

const _buildEnvVars = <N extends string, K extends string, Ns extends string>(
  secret: SecretEntry<N, K, Readonly<Record<K, string>>>,
  ref: SecretRef<N, K, Ns>
): EnvVar[] => secret.keys.map((key: K) => EnvVar.fromSecret({ name: secret.env[key], ref, key }))

// `backend`'s RequiresSource is erased to `boolean` at this generic call
// site, so the compiler can't prove `source` is present the way each
// concrete backend's own `emit` does. Catch the hole at runtime and fail
// through the Manifest's Effect channel instead of letting `emit` read
// `undefined.resolve` and throw.
const _missingSourceManifest = (backend: { readonly _tag: string }, name: string, namespace: string) =>
  Manifest.make<unknown>(() =>
    Effect.fail(
      new RenderError({
        message: `backend "${backend._tag}" requires a source but none was provided for secret "${namespace}/${name}"`
      })
    )
  )

export const bindSecret = <
  N extends string,
  K extends string,
  E extends Readonly<Record<K, string>>,
  const Ns extends string = string
>(
  input: BindSecretInput<N, K, E, Ns>
): DeclaredSecret<N, K, Ns> => {
  const { secret } = input
  const namespace = unsafeCoerce<Ns>(
    input.namespace ?? secret.namespace,
    "Ns defaults to `string`; the override (if present) is `Ns`, the secret's own namespace is `string` — runtime value either way is a string"
  )
  const ref = SecretRefValue.of<N, K, Ns>(secret.name)
  const manifest = input.backend === undefined
    ? undefined
    : input.backend.requiresSource && input.source === undefined
    ? _missingSourceManifest(input.backend, secret.name, namespace)
    : input.backend.emit({
      name: secret.name,
      namespace,
      keys: secret.keys,
      labels: input.labels,
      annotations: input.annotations,
      source: input.source
    })

  const out: DeclaredSecret<N, K, Ns> = {
    ref,
    name: secret.name,
    namespace,
    keys: secret.keys,
    envVars: _buildEnvVars(secret, ref),
    manifest,
    refLayer: Dep.provideSecret(secret.name)
  }

  return input.source === undefined
    ? out
    : { ...out, ..._buildValuesLayer({ name: secret.name, namespace, source: input.source }) }
}
