import { Effect, Schema } from "effect"

const strict = { onExcessProperty: "error" } as const

/**
 * Build a sync/effect decoder pair for `schema` that rejects unknown keys
 * (`onExcessProperty: "error"`). Shared by config schemas (`images.ts`,
 * `konfigConfig.ts`) that decode user-authored JSON/JS and want typos in
 * field names to fail loudly rather than pass through silently.
 */
export const makeStrictDecoder = <S extends Schema.Codec<unknown, unknown, never>>(schema: S) => {
  const decodeEff = Schema.decodeUnknownEffect(schema)
  return {
    sync: (input: unknown): S["Type"] => Effect.runSync(decodeEff(input, strict)),
    effect: (input: unknown) => decodeEff(input, strict)
  }
}
