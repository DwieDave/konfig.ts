import type { Config } from "effect"
import { allConfigs } from "./_record"
import type { AnyDownwardEntry, DownwardEntry } from "./downward"
import { _makeEntry, type EntryMarker, type EnvClaim, EnvNameCollision, type HasEnvClaims } from "./entry"
import type { AnyLiteralEntry, LiteralEntry } from "./literal"
import type { AnySecretEntry, SecretEntry } from "./secret"

// Environment is itself a valid EnvMember: nested bundles yield nested
// records (env.db.host), and Environment.bind walks them recursively.
export type EnvMember =
  | AnySecretEntry
  | AnyLiteralEntry
  | AnyDownwardEntry
  | AnyEnvironment

export type MemberValue<A> = [A] extends [Config.Config<infer T>] ? T : never

export type EnvironmentValues<M extends Readonly<Record<string, EnvMember>>> = {
  readonly [K in keyof M]: MemberValue<M[K]>
}

export interface Environment<M extends Readonly<Record<string, EnvMember>>>
  extends Config.Config<EnvironmentValues<M>>, EntryMarker<"Environment">, HasEnvClaims
{
  readonly members: M
}

export type AnyEnvironment = Environment<Readonly<Record<string, EnvMember>>>

const _collectClaims = (
  members: Readonly<Record<string, EnvMember>>
): ReadonlyArray<EnvClaim> => {
  const claims = Object.values(members).flatMap((member) => member.envClaims)

  const collision = claims.find((claim, index) =>
    claims.some((other, otherIndex) => otherIndex !== index && other.envName === claim.envName)
  )

  if (collision !== undefined) {
    throw new EnvNameCollision({
      envName: collision.envName,
      claims: claims.filter((claim) => claim.envName === collision.envName).map((claim) => claim.label)
    })
  }

  return claims
}

// Compile-time envName collision check; best-effort only (top-level members,
// not nested Environments) — _collectClaims is the authoritative runtime check.
type _EnvNamesOfMember<E> = E extends SecretEntry<
  infer _N,
  infer _K,
  infer Envs
> ? Envs extends Readonly<Record<string, infer V extends string>> ? V
  : never
  : E extends LiteralEntry<infer EnvName, infer _T> ? EnvName
  : E extends DownwardEntry<infer EnvName> ? EnvName
  : never

type _OthersEnvNames<
  M extends Readonly<Record<string, EnvMember>>,
  K extends keyof M
> = {
  [Other in keyof M]: Other extends K ? never : _EnvNamesOfMember<M[Other]>
}[keyof M]

type _CollisionForKey<
  M extends Readonly<Record<string, EnvMember>>,
  K extends keyof M
> = Extract<_EnvNamesOfMember<M[K]>, _OthersEnvNames<M, K>>

type _AnyCollision<M extends Readonly<Record<string, EnvMember>>> = {
  [K in keyof M]: _CollisionForKey<M, K>
}[keyof M]

type _EnvNameCollisionError<Name extends string> = {
  readonly _konfig_error: `Environment: envName "${Name}" is claimed by multiple members`
}

type _CheckCollisions<M extends Readonly<Record<string, EnvMember>>> = [
  _AnyCollision<M>
] extends [never] ? M
  : _EnvNameCollisionError<Extract<_AnyCollision<M>, string>>

const _define = <const M extends Readonly<Record<string, EnvMember>>>(
  members: M & _CheckCollisions<M>
): Environment<M> => {
  const envClaims = _collectClaims(members)

  const root: Config.Config<EnvironmentValues<M>> = allConfigs(members)

  return _makeEntry({
    config: root,
    metadata: {
      _kind: "Environment" as const,
      members,
      envClaims
    }
  })
}

// @konfig.ts/k8s re-exports this merged with its own bind/runtime.
export const Environment = {
  define: _define
}
