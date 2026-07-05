import { Data } from "effect"

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

export class HelmRenderError extends Data.TaggedError("HelmRenderError")<{
  readonly chart: string
  readonly version: string
  readonly cause: unknown
}> {}

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
}> {}

export type AnyRenderError =
  | RenderError
  | EmbedYamlReadError
  | BoundaryDecodeError
  | HelmVersionTooLow
  | HelmRenderError
  | HelmDigestMismatch
  | CrdExtractError
