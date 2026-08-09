import { type Manifest, type RenderError, unsafeCoerce } from "@konfig.ts/core"
import type {
  AnyEnvironment,
  DownwardEntry,
  Environment,
  EnvMember,
  LiteralEntry,
  SecretEntry,
  SecretSource
} from "@konfig.ts/env"
import { Layer, Match } from "effect"
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
  ]: M[K] extends SecretEntry<infer _N, infer _K, infer _E> ? SecretMemberOptionsFor<M[K]>
    : M[K] extends Environment<infer SubM> ? SecretMembersOpts<SubM>
    : never
}

export type LiteralMembersOpts<M extends Readonly<Record<string, EnvMember>>> = {
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

interface _BindAcc {
  readonly declared: Record<string, unknown>
  readonly envVars: EnvVar[]
  readonly manifests: Manifest.Manifest<unknown>[]
  readonly valuesLayers: _AnyValuesLayer[]
}

interface _DispatchInput {
  readonly memberKey: string
  readonly entry: EnvMember
  readonly secretsOpts: Record<string, unknown> | undefined
  readonly literalsOpts: Record<string, unknown> | undefined
  readonly namespace: string | undefined
  readonly acc: _BindAcc
}

const _handleSecret = (input: _DispatchInput): void => {
  const memberOpts = unsafeCoerce<SecretMemberOptions<string, string> | undefined>(
    input.secretsOpts?.[input.memberKey],
    "SecretMembersOpts<M> shape — runtime key lookup against the typed input"
  )
  const secret = unsafeCoerce<SecretEntry<string, string, Readonly<Record<string, string>>>>(
    input.entry,
    "Match.tag('Secret') narrowed entry to SecretEntry; the helper-level signature is the general SecretEntry shape"
  )
  const d = bindSecret({
    secret,
    backend: memberOpts?.backend,
    source: memberOpts?.source,
    labels: memberOpts?.labels,
    annotations: memberOpts?.annotations,
    namespace: input.namespace
  })
  input.acc.declared[input.memberKey] = d
  input.acc.envVars.push(...d.envVars)
  if (d.manifest !== undefined) input.acc.manifests.push(d.manifest)
  if (d.layer !== undefined) {
    input.acc.valuesLayers.push(
      unsafeCoerce<_AnyValuesLayer>(
        d.layer,
        "DeclaredSecret.layer is Layer<Provide<SecretValues, N>, ...>; widen to unknown for the heterogeneous Layer.mergeAll"
      )
    )
  }
}

const _handleLiteral = (input: _DispatchInput): void => {
  const literal = unsafeCoerce<LiteralEntry<string, unknown>>(
    input.entry,
    "Match.tag('Literal') narrowed entry to LiteralEntry<string, unknown>"
  )
  const d = _bindLiteral({ entry: literal, override: input.literalsOpts?.[input.memberKey] })
  input.acc.declared[input.memberKey] = d
  input.acc.envVars.push(d.envVar)
}

const _handleDownward = (input: _DispatchInput): void => {
  const downward = unsafeCoerce<DownwardEntry<string>>(
    input.entry,
    "Match.tag('Downward') narrowed entry to DownwardEntry<string>"
  )
  const d = _bindDownward({ entry: downward })
  input.acc.declared[input.memberKey] = d
  input.acc.envVars.push(d.envVar)
}

const _handleEnvironment = (input: _DispatchInput): void => {
  const subEnv = unsafeCoerce<AnyEnvironment>(
    input.entry,
    "Match.tag('Environment') narrowed entry to a nested Environment"
  )
  const sub = bindEnvironment({
    env: subEnv,
    secrets: unsafeCoerce<SecretMembersOpts<Readonly<Record<string, EnvMember>>>>(
      input.secretsOpts?.[input.memberKey] ?? {},
      "sub-record from SecretMembersOpts<M> — type is checked at the outer call site"
    ),
    literals: unsafeCoerce<LiteralMembersOpts<Readonly<Record<string, EnvMember>>>>(
      input.literalsOpts?.[input.memberKey] ?? {},
      "sub-record from LiteralMembersOpts<M> — type is checked at the outer call site"
    ),
    namespace: input.namespace
  })
  input.acc.declared[input.memberKey] = sub.members
  input.acc.envVars.push(...sub.envVars)
  input.acc.manifests.push(...sub.manifests)
  input.acc.valuesLayers.push(
    unsafeCoerce<_AnyValuesLayer>(
      sub.valuesLayer,
      "valuesLayer aggregate over the recursive merge"
    )
  )
}

const _dispatch = (input: _DispatchInput): void =>
  Match.value(input.entry._kind).pipe(
    Match.when("Secret", () => _handleSecret(input)),
    Match.when("Literal", () => _handleLiteral(input)),
    Match.when("Downward", () => _handleDownward(input)),
    Match.when("Environment", () => _handleEnvironment(input)),
    Match.exhaustive
  )

interface _DispatchAllInput {
  readonly env: AnyEnvironment
  readonly secretsOpts: Record<string, unknown> | undefined
  readonly literalsOpts: Record<string, unknown> | undefined
  readonly namespace: string | undefined
  readonly acc: _BindAcc
}

const _dispatchAllMembers = (input: _DispatchAllInput): void => {
  for (const memberKey of Object.keys(input.env.members)) {
    const entry = unsafeCoerce<EnvMember>(
      input.env.members[memberKey],
      "env.members values are EnvMember by construction"
    )
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

const _mergeValuesLayers = (layers: ReadonlyArray<_AnyValuesLayer>): _AnyValuesLayer =>
  unsafeCoerce<_AnyValuesLayer>(
    layers.length === 0 ? Layer.empty : Layer.mergeAll(layers[0]!, ...layers.slice(1)),
    "merged Layer over a heterogeneous list of per-secret value layers"
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
  const secretsOpts = unsafeCoerce<Record<string, unknown> | undefined>(
    input.secrets,
    "discriminated union from BindEnvironmentInput; iterate keys at runtime"
  )
  const literalsOpts = unsafeCoerce<Record<string, unknown> | undefined>(
    input.literals,
    "discriminated union from BindEnvironmentInput; iterate keys at runtime"
  )

  _dispatchAllMembers({ env: input.env, secretsOpts, literalsOpts, namespace: input.namespace, acc })

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
