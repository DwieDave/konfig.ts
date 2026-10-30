import { Effect, Schema } from "effect"

export const strictParseOptions = { onExcessProperty: "error" } as const

/**
 * Build a sync/effect decoder pair for `schema` that rejects unknown keys
 * (`onExcessProperty: "error"`). Shared by config schemas (`images.ts`,
 * `konfigConfig.ts`) that decode user-authored JSON/JS and want typos in
 * field names to fail loudly rather than pass through silently.
 */
export const strictDecoderOf = <S extends Schema.Codec<unknown, unknown, never>>(schema: S) => {
  const decodeEff = Schema.decodeUnknownEffect(schema)

  return {
    sync: <I>(input: I): S["Type"] => Effect.runSync(decodeEff(input, strictParseOptions)),
    effect: <I>(input: I) => decodeEff(input, strictParseOptions)
  }
}
