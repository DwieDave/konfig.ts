import { Data } from "effect"

type GoDurationUnit = "ns" | "us" | "µs" | "μs" | "ms" | "s" | "m" | "h"

export type GoDuration = "0" | `${"-" | "+" | ""}${number}${GoDurationUnit}${string}`

const goDurationPattern =
  /^[-+]?(?:0|(?:\d+(?:\.\d*)?|\.\d+)(?:ns|us|µs|μs|ms|s|m|h)(?:(?:\d+(?:\.\d*)?|\.\d+)(?:ns|us|µs|μs|ms|s|m|h))*)$/

export const isGoDuration = (value: unknown): value is GoDuration =>
  typeof value === "string" && goDurationPattern.test(value)

export class InvalidRefreshIntervalError extends Data.TaggedError("InvalidRefreshIntervalError")<{
  readonly value: unknown
}> {}
