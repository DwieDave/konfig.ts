// oxlint-disable-next-line app/no-banned-type-assertions app/no-type-assertion
export const brand = <T>(value: string): T => value as unknown as T

// Unsafe escape hatch. Every call site MUST pass a one-line `reason` explaining why the cast
// is sound — audited by grepping `unsafeCoerce(`. For trust-boundary values, prefer `boundary`.
// oxlint-disable-next-line app/no-type-assertion app/no-multiple-function-params
export const unsafeCoerce = <T>(value: unknown, _reason: string): T => value as T
