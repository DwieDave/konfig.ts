import { Effect, Schema } from "effect"

const _passthrough = Schema.decodeUnknownEffect(Schema.Any)

// Unsafe escape hatch. Every call site MUST pass a one-line `reason` explaining why the cast
// is sound — audited by grepping `unsafeCoerce[<(]` (matches both the bare `unsafeCoerce(`
// and the explicit `unsafeCoerce<T>(` form). For trust-boundary values, prefer `boundary`.
export const unsafeCoerce = <T, V = unknown>(input: { readonly value: V; readonly reason: string }): T =>
  Effect.runSync(_passthrough(input.value))

export const brand = <T>(value: string): T =>
  unsafeCoerce<T>({ value, reason: "brand tags a string with a nominal type" })
