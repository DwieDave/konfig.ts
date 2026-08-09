import { unsafeCoerce } from "@konfig.ts/core"
import { Config } from "effect"
import { _envClaim, _makeEntry, type EntryMarker, type EnvClaim, type HasEnvClaims } from "./entry"

export interface LiteralEntry<EnvName extends string, T>
  extends Config.Config<T>, EntryMarker<"Literal">, HasEnvClaims
{
  readonly envName: EnvName
  readonly value: T
  readonly serialized: string
  // Typed (unknown) => string, not (T) => string, so LiteralEntry<..., T>
  // stays assignable to LiteralEntry<string, unknown> in the EnvMember union
  // (contravariance would otherwise block the narrowing).
  readonly serialize: (value: unknown) => string
}

type _Primitive = string | number | boolean | bigint

// serialize is optional only for primitive T (default String(v) is meaningful);
// for objects/arrays it's required so values don't silently become "[object Object]".
export type DefineLiteralInput<EnvName extends string, T> =
  & {
    readonly envName: EnvName
    readonly value: T
    readonly schema?: Config.Config<T>
  }
  & (T extends _Primitive ? { readonly serialize?: (value: T) => string }
    : { readonly serialize: (value: T) => string })

const _define = <const EnvName extends string, T = string>(
  input: DefineLiteralInput<EnvName, T>
): LiteralEntry<EnvName, T> => {
  const userSerialize = input.serialize ?? ((v: T) => String(v))
  const serialize = (value: unknown): string =>
    userSerialize(
      unsafeCoerce<T>(
        value,
        "stored serialize erases its param to unknown for variance; the user-facing Literal signature guarantees the value is a T"
      )
    )
  const serialized = userSerialize(input.value)

  const parser = input.schema !== undefined
    ? input.schema
    : unsafeCoerce<Config.Config<T>>(
      Config.succeed(input.value),
      "Config.succeed of the T-typed input.value is a constant Config<T>"
    )

  const envClaims: ReadonlyArray<EnvClaim> = [
    _envClaim({ envName: input.envName, label: `Literal(${input.envName})` })
  ]

  return _makeEntry({
    config: parser,
    metadata: {
      _kind: "Literal" as const,
      envName: input.envName,
      value: input.value,
      serialized,
      serialize,
      envClaims
    }
  })
}

export type AnyLiteralEntry = LiteralEntry<string, unknown>

export const Literal = {
  define: _define
}
