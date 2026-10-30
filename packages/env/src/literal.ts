import { Config } from "effect"
import { _envClaim, _makeEntry, type EntryMarker, type HasEnvClaims } from "./entry"

export interface LiteralEntry<EnvName extends string, T>
  extends Config.Config<T>, EntryMarker<"Literal">, HasEnvClaims
{
  readonly envName: EnvName
  readonly value: T
  readonly serialized: string
  serialize(value: T): string
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
  const parser: Config.Config<T> = input.schema !== undefined ? input.schema : Config.succeed(input.value)

  return _makeEntry({
    config: parser,
    metadata: {
      _kind: "Literal" as const,
      envName: input.envName,
      value: input.value,
      serialized: userSerialize(input.value),
      serialize: userSerialize,
      envClaims: [_envClaim({ envName: input.envName, label: `Literal(${input.envName})` })]
    }
  })
}

export type AnyLiteralEntry = LiteralEntry<string, unknown>

export const Literal = {
  define: _define
}
