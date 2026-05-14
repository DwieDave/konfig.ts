import { Data } from "effect";

// Generic render-time failure. Operators (embedYaml file read, helm template
// invocation in M6) raise the more specific subclasses; consumers narrow on
// `_tag`.
export class RenderError extends Data.TaggedError("RenderError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class EmbedYamlReadError extends Data.TaggedError("EmbedYamlReadError")<{
	readonly path: string;
	readonly cause: unknown;
}> {}

export class BoundaryDecodeError extends Data.TaggedError("BoundaryDecodeError")<{
	readonly schema: string;
	readonly cause: unknown;
}> {}

export class HelmVersionTooLow extends Data.TaggedError("HelmVersionTooLow")<{
	readonly required: string;
	readonly found: string;
}> {}

export class HelmRenderError extends Data.TaggedError("HelmRenderError")<{
	readonly chart: string;
	readonly version: string;
	readonly cause: unknown;
}> {}

export class CrdExtractError extends Data.TaggedError("CrdExtractError")<{
	readonly chart: string;
	readonly cause: unknown;
}> {}

export type AnyRenderError =
	| RenderError
	| EmbedYamlReadError
	| BoundaryDecodeError
	| HelmVersionTooLow
	| HelmRenderError
	| CrdExtractError;
