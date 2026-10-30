import { Effect, Schema } from "effect"

const _passthrough = Schema.decodeUnknownEffect(Schema.Any)

// Unsafe escape hatch. Every call site MUST pass a one-line `reason` explaining why the cast
// is sound — audited by grepping `unsafeCoerce[<(]` (matches both the bare `unsafeCoerce(`
// and the explicit `unsafeCoerce<T>(` form). For trust-boundary values, prefer `boundary`.
// oxlint-disable-next-line app/no-multiple-function-params
export const unsafeCoerce = <T, V = unknown>(value: V, _reason: string): T => Effect.runSync(_passthrough(value))

export const brand = <T>(value: string): T => unsafeCoerce<T>(value, "brand tags a string with a nominal type")
