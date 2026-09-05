// Reads the `default` export off a dynamically imported module without
// assuming its shape — `in` narrowing keeps this fully type-checked; callers
// guard the returned `unknown` themselves.
export const moduleDefault = (mod: unknown): unknown =>
  typeof mod === "object" && mod !== null && "default" in mod ? mod.default : undefined
