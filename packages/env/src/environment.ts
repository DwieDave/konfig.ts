import { unsafeCoerce } from "@konfig.ts/core"
import { Config } from "effect"
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

export type MemberValue<A> = A extends Config.Config<infer T> ? T : never

export interface Environment<M extends Readonly<Record<string, EnvMember>>>
  extends Config.Config<{ readonly [K in keyof M]: MemberValue<M[K]> }>, EntryMarker<"Environment">, HasEnvClaims
{
  readonly members: M
}

// oxlint-disable-next-line app/no-explicit-any
export type AnyEnvironment = Environment<Readonly<Record<string, any>>>

// Throws EnvNameCollision synchronously (not Effect): Environment.define
// is a synchronous builder and collisions are an authoring mistake caught
// at module-load time, same moment _CheckCollisions flags most at compile time.
const _collectClaims = (
  members: Readonly<Record<string, EnvMember>>
): ReadonlyArray<EnvClaim> => {
  const byEnvName = new Map<string, string[]>()
  const out: EnvClaim[] = []
  for (const [, entry] of Object.entries(members)) {
    for (const claim of entry.envClaims) {
      const prior = byEnvName.get(claim.envName)
      if (prior === undefined) {
        byEnvName.set(claim.envName, [claim.label])
      } else {
        prior.push(claim.label)
      }
      out.push(claim)
    }
  }
  for (const [envName, labels] of byEnvName) {
    if (labels.length > 1) {
      throw new EnvNameCollision({ envName, claims: labels })
    }
  }
  return out
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

  const root = unsafeCoerce<
    Config.Config<
      {
        readonly [K in keyof M]: MemberValue<M[K]>
      }
    >
  >(
    Config.all(members),
    "Config.all over the members record yields a Config of the mapped record whose values are each member's MemberValue"
  )

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
