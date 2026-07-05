import { unsafeCoerce } from "@konfig.ts/core"
import { Config } from "effect"
import { _makeEntry, type EntryMarker, type EnvClaim, type HasEnvClaims } from "./entry"

export interface LiteralEntry<EnvName extends string, T>
  extends Config.Config<T>, EntryMarker<"Literal">, HasEnvClaims
{
  readonly envName: EnvName
  readonly value: T
  readonly serialized: string
  /**
   * Stored so bind-time value overrides can re-serialize with the same
   * fn. Typed as `(unknown) => string` so that `LiteralEntry<…, T>`
   * stays assignable to `LiteralEntry<string, unknown>` in the
   * `EnvMember` union (function params are contravariant — a more
   * specific T would block the narrowing). The override site supplies
   * a value typed against `T` via `LiteralMembersOpts<M>`.
   */
  readonly serialize: (value: unknown) => string
}

export interface DefineLiteralInput<EnvName extends string, T> {
  readonly envName: EnvName
  readonly value: T
  readonly schema?: Config.Config<T>
  readonly serialize?: (value: T) => string
}

const _define = <const EnvName extends string, T = string>(
  input: DefineLiteralInput<EnvName, T>
): LiteralEntry<EnvName, T> => {
  const userSerialize = input.serialize ?? ((v: T) => String(v))
  // Erase the parameter type to `unknown` for the stored function — see
  // the LiteralEntry doc for the variance rationale. Literal's
  // own type signature still enforces `T` at the user-facing call site.
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
    { envName: input.envName, label: `Literal(${input.envName})` }
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

/**
 * `Literal` value namespace.
 *
 *   const port = Literal.define({
 *     envName: "PORT", value: 8080,
 *     schema: Config.number("PORT").pipe(Config.withDefault(8080)),
 *   });
 */
export const Literal = {
  define: _define
}
