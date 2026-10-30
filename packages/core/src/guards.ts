import { Predicate } from "effect"

/** Narrow an unknown value to a plain keyed record (object, not null, not an array). */
export const isRecord = Predicate.isObject
