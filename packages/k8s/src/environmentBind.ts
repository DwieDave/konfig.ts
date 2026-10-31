import type { Dep } from "@konfig.ts/core"
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
import type { SecretBackend } from "./backendKit"
import type { EnvVar } from "./env"
import type { StringMap } from "./meta"
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

type _SecretNamesOf<M extends Readonly<Record<string, EnvMember>>> = {
  readonly [K in keyof M]: M[K] extends SecretEntry<infer N, infer _K, infer _E> ? N
    : M[K] extends Environment<infer Sub> ? _SecretNamesOf<Sub>
    : never
}[keyof M]

type _ProvideValues<N> = N extends string ? Dep.Provide<"SecretValues", N> : never

type DeclaredValuesLayer<M extends Readonly<Record<string, EnvMember>>> = Layer.Layer<
  _ProvideValues<_SecretNamesOf<M>>,
  RenderError,
  Manifest.RenderServices
>

export interface DeclaredEnvironment<
  M extends Readonly<Record<string, EnvMember>>,
  Ns extends string = string
> {
  readonly envVars: ReadonlyArray<EnvVar>
  readonly manifests: ReadonlyArray<Manifest.Manifest<unknown>>
  readonly members: { readonly [K in keyof M]: DeclaredMember<M[K], Ns> }
  readonly valuesLayer: DeclaredValuesLayer<M>
}

interface _SecretMemberOptionsBase {
  readonly labels?: StringMap
  readonly annotations?: StringMap
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

export type SecretMemberOptionsFor<A> = A extends SecretEntry<infer N, infer K, infer _E>
  ? [N, K] extends [string, string] ? SecretMemberOptions<N, K>
  : never
  : never

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
  readonly override?: _LiteralValue | _LiteralNode
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

// Layer's ROut parameter is contravariant, so every per-member layer
// (Layer<Provide<"SecretValues", N>, ...>) is assignable to Layer<never, ...>
// without a cast; `bindEnvironment` narrows the merged layer to the member-derived output once.
type _CollectedLayer = Layer.Layer<never, RenderError, Manifest.RenderServices>

type _Declared =
  | DeclaredSecret<string, string, string>
  | DeclaredLiteral<string, unknown>
  | DeclaredDownward<string>
  | _DeclaredNode

interface _DeclaredNode {
  readonly [key: string]: _Declared
}

type _LiteralValue = string | number | boolean | bigint | null | ReadonlyArray<_LiteralValue>

interface _LiteralNode {
  readonly [key: string]: _LiteralValue | _LiteralNode | undefined
}

interface _SecretNode {
  readonly [key: string]: SecretMemberInput<string, string> | _SecretNode
}

interface _Fragment {
  readonly declared: Readonly<Record<string, _Declared>>
  readonly envVars: ReadonlyArray<EnvVar>
  readonly manifests: ReadonlyArray<Manifest.Manifest<unknown>>
  readonly valuesLayers: ReadonlyArray<_CollectedLayer>
}

const _emptyFragment: _Fragment = { declared: {}, envVars: [], manifests: [], valuesLayers: [] }

const _mergeFragments = (input: { readonly left: _Fragment; readonly right: _Fragment }): _Fragment => ({
  declared: { ...input.left.declared, ...input.right.declared },
  envVars: [...input.left.envVars, ...input.right.envVars],
  manifests: [...input.left.manifests, ...input.right.manifests],
  valuesLayers: [...input.left.valuesLayers, ...input.right.valuesLayers]
})

interface _DispatchInput {
  readonly memberKey: string
  readonly entry: EnvMember
  readonly secretsOpts: _SecretNode | undefined
  readonly literalsOpts: _LiteralNode | undefined
  readonly namespace: string | undefined
}

// The object form has no `_tag`; both `SecretSource` and `SecretBackend` carry one,
// so a tagged value is the bare shorthand and gets wrapped into the object form.
const _normalizeSecretMember = (
  raw: SecretMemberInput<string, string> | undefined
): SecretMemberOptions<string, string> | undefined => {
  if (raw === undefined || !("_tag" in raw)) return raw

  return "emit" in raw ? { backend: raw } : { source: raw }
}

type _SecretValue = SecretMemberInput<string, string> | _SecretNode

const _lookup = <V>(input: { readonly node: { readonly [key: string]: V } | undefined; readonly key: string }) =>
  input.node === undefined ? undefined : Object.entries(input.node).find(([k]) => k === input.key)?.[1]

const _isSecretInput = (value: _SecretValue | undefined): value is SecretMemberInput<string, string> =>
  Predicate.isObject(value) &&
  ("_tag" in value ? "emit" in value || "resolve" in value : "backend" in value || "source" in value)

const _asSecretInput = (value: _SecretValue | undefined): SecretMemberInput<string, string> | undefined =>
  _isSecretInput(value) ? value : undefined

const _isSecretNode = (value: _SecretValue | undefined): value is _SecretNode => Predicate.isObject(value)

const _isLiteralNode = (value: _LiteralValue | _LiteralNode | undefined): value is _LiteralNode =>
  Predicate.isObject(value) && !Array.isArray(value)

const _asSecretNode = (value: _SecretValue | undefined): _SecretNode | undefined =>
  _isSecretNode(value) ? value : undefined

const _isRootLiteralNode = <M extends Readonly<Record<string, EnvMember>>>(
  value: LiteralMembersOpts<M> | undefined
): value is LiteralMembersOpts<M> & _LiteralNode => Predicate.isObject(value) && !Array.isArray(value)

const _rootLiteralNode = <M extends Readonly<Record<string, EnvMember>>>(
  value: LiteralMembersOpts<M> | undefined
): _LiteralNode | undefined => _isRootLiteralNode(value) ? value : undefined

const _asLiteralNode = (value: _LiteralValue | _LiteralNode | undefined): _LiteralNode | undefined =>
  _isLiteralNode(value) ? value : undefined

const _handleSecret = (
  { entry, input }: { readonly entry: AnySecretEntry; readonly input: _DispatchInput }
): _Fragment => {
  const memberOpts = _normalizeSecretMember(_asSecretInput(_lookup({ node: input.secretsOpts, key: input.memberKey })))

  const d = bindSecret({
    secret: entry,
    backend: memberOpts?.backend,
    source: memberOpts?.source,
    labels: memberOpts?.labels,
    annotations: memberOpts?.annotations,
    namespace: input.namespace
  })

  return {
    declared: { [input.memberKey]: d },
    envVars: d.envVars,
    manifests: d.manifest === undefined ? [] : [d.manifest],
    valuesLayers: d.layer === undefined ? [] : [d.layer]
  }
}

const _handleLiteral = (
  { entry, input }: { readonly entry: AnyLiteralEntry; readonly input: _DispatchInput }
): _Fragment => {
  const override = _lookup({ node: input.literalsOpts, key: input.memberKey })
  const d = _bindLiteral({ entry, override })

  return { ..._emptyFragment, declared: { [input.memberKey]: d }, envVars: [d.envVar] }
}

const _handleDownward = (
  { entry, input }: { readonly entry: AnyDownwardEntry; readonly input: _DispatchInput }
): _Fragment => {
  const d = _bindDownward({ entry })

  return { ..._emptyFragment, declared: { [input.memberKey]: d }, envVars: [d.envVar] }
}

const _handleEnvironment = (
  { entry, input }: { readonly entry: AnyEnvironment; readonly input: _DispatchInput }
): _Fragment => {
  const inner = _dispatchAllMembers({
    members: entry.members,
    secretsOpts: _asSecretNode(_lookup({ node: input.secretsOpts, key: input.memberKey })),
    literalsOpts: _asLiteralNode(_lookup({ node: input.literalsOpts, key: input.memberKey })),
    namespace: input.namespace
  })

  return { ...inner, declared: { [input.memberKey]: inner.declared } }
}

const _dispatch = (input: _DispatchInput): _Fragment =>
  Match.value(input.entry).pipe(
    Match.discriminatorsExhaustive("_kind")({
      Secret: (entry: AnySecretEntry) => _handleSecret({ entry, input }),
      Literal: (entry: AnyLiteralEntry) => _handleLiteral({ entry, input }),
      Downward: (entry: AnyDownwardEntry) => _handleDownward({ entry, input }),
      Environment: (entry: AnyEnvironment) => _handleEnvironment({ entry, input })
    })
  )

interface _DispatchAllInput {
  readonly members: Readonly<Record<string, EnvMember>>
  readonly secretsOpts: _SecretNode | undefined
  readonly literalsOpts: _LiteralNode | undefined
  readonly namespace: string | undefined
}

const _dispatchAllMembers = (input: _DispatchAllInput): _Fragment =>
  Object.entries(input.members)
    .map(([memberKey, entry]) =>
      _dispatch({
        memberKey,
        entry,
        secretsOpts: input.secretsOpts,
        literalsOpts: input.literalsOpts,
        namespace: input.namespace
      })
    )
    .reduce((left, right) => _mergeFragments({ left, right }), _emptyFragment)

const _mergeValuesLayers = (layers: ReadonlyArray<_CollectedLayer>): _CollectedLayer => {
  const [first, ...rest] = layers

  return first === undefined ? Layer.empty : Layer.mergeAll(first, ...rest)
}

export const bindEnvironment = <
  const M extends Readonly<Record<string, EnvMember>>,
  const Ns extends string = string
>(
  input: BindEnvironmentInput<M, Ns>
): DeclaredEnvironment<M, Ns> => {
  const fragment = _dispatchAllMembers({
    members: input.env.members,
    secretsOpts: _asSecretNode(input.secrets),
    literalsOpts: _rootLiteralNode(input.literals),
    namespace: input.namespace
  })

  return {
    envVars: fragment.envVars,
    manifests: fragment.manifests,
    members: unsafeCoerce<{ readonly [K in keyof M]: DeclaredMember<M[K], Ns> }>({
      value: fragment.declared,
      reason: "declared is built by folding env.members; each key maps to its DeclaredMember<M[K], Ns>"
    }),
    valuesLayer: unsafeCoerce<DeclaredValuesLayer<M>>({
      value: _mergeValuesLayers(fragment.valuesLayers),
      reason:
        "the merged layer provides exactly one SecretValues service per secret member that has a source; DeclaredValuesLayer names them from M"
    })
  }
}
