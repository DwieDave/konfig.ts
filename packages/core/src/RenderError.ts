import { Data } from "effect"
import { processDetail } from "./subprocess"

export class RenderError extends Data.TaggedError("RenderError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class EmbedYamlReadError extends Data.TaggedError("EmbedYamlReadError")<{
  readonly path: string
  readonly cause: unknown
}> {}

export class BoundaryDecodeError extends Data.TaggedError("BoundaryDecodeError")<{
  readonly schema: string
  readonly cause: unknown
}> {}

export class HelmVersionTooLow extends Data.TaggedError("HelmVersionTooLow")<{
  readonly required: string
  readonly found: string
}> {
  get message(): string {
    return `Helm CLI too old: requires >= ${this.required}, found ${this.found}`
  }
}

// Which helm step failed. Process failures carry their own exit code and
// stderr tail; the phase tells the reader whether it was the local `helm
// version` preflight, the network-bound pull, the template run, or parsing
// its output.
export type HelmRenderPhase = "version-check" | "pull" | "template" | "parse"

// processDetail covers ProcessError/ProcessTimeout; everything else (a plain
// string from a sanity check, a PlatformError, a ConfigError) falls back to
// its message so the one-liner never ends in a bare "failed during pull".
const _causeDetail = (cause: unknown): string => {
  const process = processDetail(cause)
  if (process.length > 0) return process
  if (typeof cause === "string") return `: ${cause}`
  if (cause instanceof Error && cause.message.length > 0) return `: ${cause.message}`
  return ""
}

export class HelmRenderError extends Data.TaggedError("HelmRenderError")<{
  readonly chart: string
  readonly version: string
  readonly phase: HelmRenderPhase
  readonly cause: unknown
}> {
  get message(): string {
    return `Helm chart ${this.chart}@${this.version} failed during ${this.phase}${_causeDetail(this.cause)}`
  }
}

export class HelmDigestMismatch extends Data.TaggedError("HelmDigestMismatch")<{
  readonly chart: string
  readonly version: string
  readonly expected: string
  readonly actual: string
}> {
  get message(): string {
    return `Helm chart ${this.chart}@${this.version} digest mismatch: expected ${this.expected}, got ${this.actual}`
  }
}

export class CrdExtractError extends Data.TaggedError("CrdExtractError")<{
  readonly chart: string
  readonly cause: unknown
}> {
  get message(): string {
    return `CRD extraction for chart ${this.chart} failed${_causeDetail(this.cause)}`
  }
}

export type AnyRenderError =
  | RenderError
  | EmbedYamlReadError
  | BoundaryDecodeError
  | HelmVersionTooLow
  | HelmRenderError
  | HelmDigestMismatch
  | CrdExtractError
