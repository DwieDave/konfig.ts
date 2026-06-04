/**
 * Nominal-typing primitive — attach a phantom brand to a string value.
 * Used by `Dep.*Ref` constructors and the like. Safe by construction:
 * the brand is a type-only label that the caller stamps on themselves.
 */
// oxlint-disable-next-line app/no-banned-type-assertions app/no-type-assertion
export const brand = <T>(value: string): T => value as unknown as T;

/**
 * Unsafe escape hatch — claim a value has type `T` without runtime
 * proof. Every call site MUST pass a one-line `reason` explaining why
 * the cast is sound (e.g. "variance erasure", "runtime narrowed via
 * _tag check", "Object.keys is string[]"). Audit by grepping for
 * `unsafeCoerce(` and reading the reasons.
 *
 * For values crossing a trust boundary (external command output, file
 * contents, network payloads), prefer `boundary` from
 * `@konfig.ts/core/boundary` — it produces a `BoundaryDecodeError`
 * instead of silently accepting the claim.
 *
 * The `reason` parameter is intentionally not used at runtime; it
 * documents intent for readers and audits.
 */
// oxlint-disable-next-line app/no-type-assertion
export const unsafeCoerce = <T>(value: unknown, _reason: string): T => value as T;

/**
 * @deprecated Prefer `unsafeCoerce(value, reason)` so every site
 * documents WHY the cast is sound, or `boundary(schema)` for values
 * crossing a trust boundary. This alias remains for backwards
 * compatibility with existing 0.0.x call sites and will be removed
 * before 1.0.
 */
// oxlint-disable-next-line app/no-type-assertion
export const coerce = <T>(value: unknown): T => value as T;
