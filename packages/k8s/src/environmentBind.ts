import { type Manifest, type RenderError, unsafeCoerce } from "@konfig.ts/core"
import type {
  AnyDownwardEntry,
  AnyEnvironment,
  AnyLiteralEntry,
  AnySecretEntry,
  DownwardEntry,
  Environment,
  EnvMember,
  LiteralEntry,
  SecretEntry,
  SecretSource
} from "@konfig.ts/env"
import { Layer, Match, Predicate } from "effect"
import type { SecretBackend } from "./backend"
import type { EnvVar } from "./env"
import { bindSecret, type DeclaredSecret } from "./secretBind"

export interface DeclaredLiteral<EnvName extends string, T> {
  readonly envName: EnvName
  readonly value: T
  readonly envVar: EnvVar
}

export interface DeclaredDownward<EnvName extends string> {
  readonly envName: EnvName
  readonly fieldPath: string
  readonly envVar: EnvVar
}

export type DeclaredMember<
  A extends EnvMember,
  Ns extends string = string
> = A extends SecretEntry<infer N, infer K, infer _E> ? [N, K] extends [string, string] ? DeclaredSecret<N, K, Ns>
  : never
  : A extends LiteralEntry<infer EnvName, infer T> ? [EnvName] extends [string] ? DeclaredLiteral<EnvName, T>
    : never
  : A extends DownwardEntry<infer EnvName> ? [EnvName] extends [string] ? DeclaredDownward<EnvName>
    : never
  : A extends Environment<infer SubM> ? { readonly [K in keyof SubM]: DeclaredMember<SubM[K], Ns> }
  : never

export interface DeclaredEnvironment<
  M extends Readonly<Record<string, EnvMember>>,
  Ns extends string = string
> {
  readonly envVars: ReadonlyArray<EnvVar>
  readonly manifests: ReadonlyArray<Manifest.Manifest<unknown>>
  readonly members: { readonly [K in keyof M]: DeclaredMember<M[K], Ns> }
  readonly valuesLayer: Layer.Layer<unknown, RenderError, Manifest.RenderServices>
}

interface _SecretMemberOptionsBase {
  readonly labels?: Readonly<Record<string, string>>
  readonly annotations?: Readonly<Record<string, string>>
}

interface _SecretMemberBackendRequiresSource<N extends string, K extends string> extends _SecretMemberOptionsBase {
  readonly backend: SecretBackend<N, K, true>
  readonly source: SecretSource<K, Manifest.RenderServices>
}

interface _SecretMemberBackendOptionalSource<N extends string, K extends string> extends _SecretMemberOptionsBase {
  readonly backend: SecretBackend<N, K, false>
  readonly source?: SecretSource<K, Manifest.RenderServices>
}

interface _SecretMemberSourceOnly<_N extends string, K extends string> extends _SecretMemberOptionsBase {
  readonly backend?: undefined
  readonly source: SecretSource<K, Manifest.RenderServices>
}

export type SecretMemberOptions<N extends string, K extends string> =
  | _SecretMemberBackendRequiresSource<N, K>
  | _SecretMemberBackendOptionalSource<N, K>
  | _SecretMemberSourceOnly<N, K>

export type SecretMemberOptionsFor<A> = A extends SecretEntry<infer N, infer K, infer _E>
  ? [N, K] extends [string, string] ? SecretMemberOptions<N, K>
  : never
  : never

/**
 * What a secret member accepts in `Environment.bind({ secrets })`: the
 * `{ backend?, source?, labels?, annotations? }` object, or — as a shorthand —
 * a bare backend or source. A bare backend is only accepted when it does not
 * require a source (`SecretBackend<N, K, false>`), so `NativeSecret.backend()`
 * still has to be paired with a `source` via the object form.
 */
export type SecretMemberInput<N extends string, K extends string> =
  | SecretMemberOptions<N, K>
  | SecretBackend<N, K, false>
  | SecretSource<K, Manifest.RenderServices>

export type SecretMemberInputFor<A> = A extends SecretEntry<infer N, infer K, infer _E>
  ? [N, K] extends [string, string] ? SecretMemberInput<N, K>
  : never
  : never

export type HasSecrets<M extends Readonly<Record<string, EnvMember>>> = true extends {
  readonly [K in keyof M]: M[K] extends SecretEntry<infer _N, infer _K, infer _E> ? true
    : M[K] extends Environment<infer Sub> ? HasSecrets<Sub>
    : false
}[keyof M] ? true
  : false

export type SecretMembersOpts<M extends Readonly<Record<string, EnvMember>>> = {
  readonly [
    K in keyof M as M[K] extends SecretEntry<infer _N, infer _K, infer _E> ? K
      : M[K] extends Environment<infer SubM> ? HasSecrets<SubM> extends true ? K
        : never
      : never
  ]: M[K] extends SecretEntry<infer _N, infer _K, infer _E> ? SecretMemberInputFor<M[K]>
    : M[K] extends Environment<infer SubM> ? SecretMembersOpts<SubM>
    : never
}

type LiteralMembersOpts<M extends Readonly<Record<string, EnvMember>>> = {
  readonly [
    K in keyof M as M[K] extends LiteralEntry<infer _EnvName, infer _T> ? K
      : M[K] extends Environment<infer _SubM> ? K
      : never
  ]?: M[K] extends LiteralEntry<infer _EnvName, infer T> ? T
    : M[K] extends Environment<infer SubM> ? LiteralMembersOpts<SubM>
    : never
}

interface _BindEnvironmentInputBase<
  M extends Readonly<Record<string, EnvMember>>,
  Ns extends string = string
> {
  readonly env: Environment<M>
  readonly literals?: LiteralMembersOpts<M>
  readonly namespace?: Ns
}

export type BindEnvironmentInput<
  M extends Readonly<Record<string, EnvMember>>,
  Ns extends string = string
> =
  & _BindEnvironmentInputBase<M, Ns>
  & (HasSecrets<M> extends true ? { readonly secrets: SecretMembersOpts<M> }
    : { readonly secrets?: SecretMembersOpts<M> })

interface _BindLiteralInput {
  readonly entry: LiteralEntry<string, unknown>
  readonly override?: unknown
}
const _bindLiteral = (input: _BindLiteralInput): DeclaredLiteral<string, unknown> => {
  const hasOverride = input.override !== undefined
  const value = hasOverride ? input.override : input.entry.value
  const serialized = hasOverride
    ? input.entry.serialize(input.override)
    : input.entry.serialized
  return {
    envName: input.entry.envName,
    value,
    envVar: { name: input.entry.envName, value: serialized }
  }
}

interface _BindDownwardInput {
  readonly entry: DownwardEntry<string>
}
const _bindDownward = (input: _BindDownwardInput): DeclaredDownward<string> => ({
  envName: input.entry.envName,
  fieldPath: input.entry.fieldPath,
  envVar: {
    name: input.entry.envName,
    valueFrom: { fieldRef: { fieldPath: input.entry.fieldPath } }
  }
})

type _AnyValuesLayer = Layer.Layer<unknown, RenderError, Manifest.RenderServices>

// Layer's ROut parameter is contravariant, so every per-member layer
// (Layer<Provide<"SecretValues", N>, ...>) is assignable to Layer<never, ...>
// without a cast; the fold in `_mergeValuesLayers` widens the result once.
type _CollectedLayer = Layer.Layer<never, RenderError, Manifest.RenderServices>

interface _BindAcc {
  readonly declared: Record<string, unknown>
  readonly envVars: EnvVar[]
  readonly manifests: Manifest.Manifest<unknown>[]
  readonly valuesLayers: _CollectedLayer[]
}

interface _DispatchInput {
  readonly memberKey: string
  readonly entry: EnvMember
  readonly secretsOpts: Record<string, unknown> | undefined
  readonly literalsOpts: Record<string, unknown> | undefined
  readonly namespace: string | undefined
  readonly acc: _BindAcc
}

// The object form has no `_tag`; both `SecretSource` and `SecretBackend` carry one,
// so a tagged value is the bare shorthand and gets wrapped into the object form.
const _normalizeSecretMember = (
  raw: SecretMemberInput<string, string> | undefined
): SecretMemberOptions<string, string> | undefined => {
  if (raw === undefined || !("_tag" in raw)) return raw
  return raw._tag === "SecretSource" ? { source: raw } : { backend: raw }
}

// The typed options records (SecretMembersOpts / LiteralMembersOpts and their
// nested sub-records) are walked with runtime string keys; this helper is the
// single boundary where the typed view becomes Record<string, unknown>.
const _asRecord = (value: unknown): Record<string, unknown> | undefined =>
  Predicate.isObject(value) ? value : undefined

const _handleSecret = (entry: AnySecretEntry, input: _DispatchInput): void => {
  const memberOpts = _normalizeSecretMember(
    unsafeCoerce<SecretMemberInput<string, string> | undefined>(
      input.secretsOpts?.[input.memberKey],
      "SecretMembersOpts<M> puts a SecretMemberInput under every secret member's key; the runtime key lookup erases that"
    )
  )
  const d = bindSecret({
    secret: entry,
    backend: memberOpts?.backend,
    source: memberOpts?.source,
    labels: memberOpts?.labels,
    annotations: memberOpts?.annotations,
    namespace: input.namespace
  })
  input.acc.declared[input.memberKey] = d
  input.acc.envVars.push(...d.envVars)
  if (d.manifest !== undefined) input.acc.manifests.push(d.manifest)
  if (d.layer !== undefined) input.acc.valuesLayers.push(d.layer)
}

const _handleLiteral = (entry: AnyLiteralEntry, input: _DispatchInput): void => {
  const d = _bindLiteral({ entry, override: input.literalsOpts?.[input.memberKey] })
  input.acc.declared[input.memberKey] = d
  input.acc.envVars.push(d.envVar)
}

const _handleDownward = (entry: AnyDownwardEntry, input: _DispatchInput): void => {
  const d = _bindDownward({ entry })
  input.acc.declared[input.memberKey] = d
  input.acc.envVars.push(d.envVar)
}

const _handleEnvironment = (entry: AnyEnvironment, input: _DispatchInput): void => {
  const acc: _BindAcc = { declared: {}, envVars: [], manifests: [], valuesLayers: [] }
  _dispatchAllMembers({
    members: entry.members,
    secretsOpts: _asRecord(input.secretsOpts?.[input.memberKey]),
    literalsOpts: _asRecord(input.literalsOpts?.[input.memberKey]),
    namespace: input.namespace,
    acc
  })
  input.acc.declared[input.memberKey] = acc.declared
  input.acc.envVars.push(...acc.envVars)
  input.acc.manifests.push(...acc.manifests)
  input.acc.valuesLayers.push(...acc.valuesLayers)
}

const _dispatch = (input: _DispatchInput): void =>
  Match.value(input.entry).pipe(
    Match.discriminatorsExhaustive("_kind")({
      Secret: (entry: AnySecretEntry) => _handleSecret(entry, input),
      Literal: (entry: AnyLiteralEntry) => _handleLiteral(entry, input),
      Downward: (entry: AnyDownwardEntry) => _handleDownward(entry, input),
      Environment: (entry: AnyEnvironment) => _handleEnvironment(entry, input)
    })
  )

interface _DispatchAllInput {
  readonly members: Readonly<Record<string, EnvMember>>
  readonly secretsOpts: Record<string, unknown> | undefined
  readonly literalsOpts: Record<string, unknown> | undefined
  readonly namespace: string | undefined
  readonly acc: _BindAcc
}

const _dispatchAllMembers = (input: _DispatchAllInput): void => {
  for (const [memberKey, entry] of Object.entries(input.members)) {
    _dispatch({
      memberKey,
      entry,
      secretsOpts: input.secretsOpts,
      literalsOpts: input.literalsOpts,
      namespace: input.namespace,
      acc: input.acc
    })
  }
}

const _mergeValuesLayers = (layers: ReadonlyArray<_CollectedLayer>): _AnyValuesLayer =>
  unsafeCoerce<_AnyValuesLayer>(
    layers.length === 0 ? Layer.empty : Layer.mergeAll(layers[0]!, ...layers.slice(1)),
    "the fold provides every collected SecretValues service; ROut is widened from never to unknown so consumers can Effect.provide the aggregate"
  )

export const bindEnvironment = <
  const M extends Readonly<Record<string, EnvMember>>,
  const Ns extends string = string
>(
  input: BindEnvironmentInput<M, Ns>
): DeclaredEnvironment<M, Ns> => {
  const acc: _BindAcc = {
    declared: {},
    envVars: [],
    manifests: [],
    valuesLayers: []
  }
  _dispatchAllMembers({
    members: input.env.members,
    secretsOpts: _asRecord(input.secrets),
    literalsOpts: _asRecord(input.literals),
    namespace: input.namespace,
    acc
  })

  return {
    envVars: acc.envVars,
    manifests: acc.manifests,
    members: unsafeCoerce<{ readonly [K in keyof M]: DeclaredMember<M[K], Ns> }>(
      acc.declared,
      "declared populated by iterating env.members; each key maps to its DeclaredMember<M[K], Ns>"
    ),
    valuesLayer: _mergeValuesLayers(acc.valuesLayers)
  }
}
