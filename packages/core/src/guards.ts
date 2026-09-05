/** Narrow an unknown value to a plain keyed record (object, not null, not an array). */
export const isRecord = (u: unknown): u is Record<string, unknown> =>
  // oxlint-disable-next-line app/no-typeof-object -- this IS the explicit null-and-object guard the rule points to
  typeof u === "object" && u !== null && !Array.isArray(u)
