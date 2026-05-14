// @konfig.ts/core — typesafe Kubernetes manifest primitives.
//
// Public surface (post-M9):
//   • `Manifest<A>` — a renderable resource (just the render Effect; no
//     more R/P slots).
//   • `Dep.*` — yieldable `Context.Service` Keys for the five tracked
//     kinds. Yielding lifts the req into the surrounding Effect's R;
//     `Layer.succeed(Key, value)` discharges it. The bespoke
//     `Manifest<A, R, P>` record algebra is gone.
//   • Stable YAML serializer + structural diff + tsk-config + boundary.

export { boundary } from "./boundary";
export type {
	ConfigMapRef,
	ConfigMapRefName,
	Need,
	Provide,
	PvcRef,
	PvcRefName,
	SecretRef,
	SecretRefName,
	ServiceAccountRef,
} from "./deps";
// Yieldable dep Keys — `Dep.Secret(name)` etc. yield the brand and
// lift the req into the surrounding Effect's R. The brand-name TYPES
// are re-exported at the top level so consumers can use them without
// the `Dep.` prefix.
export * as Dep from "./deps";
export {
	type DiffFormat,
	type DiffResult,
	deepEqual,
	diffFiles,
	type FileDiff,
	formatDiff,
	hasDifferences,
	parseYaml,
	redact,
} from "./diff";
export * as Helm from "./Helm";
export {
	decodeImagesEffect,
	decodeImagesSync,
	EnvImages,
	ImagesAppMissing,
	ImagesConfig,
	ImagesEnvMissing,
	imagesFor,
	lookupEnv,
	lookupEnvEffect,
	requireImage,
} from "./images";
export {
	CrdConfig,
	DiffConfig,
	decodeKonfigConfigEffect,
	decodeKonfigConfigSync,
	EnvEntry,
	HelmConfig,
	KonfigConfig,
	OutDir,
	type ResolvedKonfigConfig,
	ServicesConfig,
} from "./konfigConfig";
export type { EmbedYamlSource, RawYaml } from "./Manifest";
export * as Manifest from "./Manifest";
export { RenderContext } from "./RenderContext";
export {
	type AnyRenderError,
	BoundaryDecodeError,
	CrdExtractError,
	EmbedYamlReadError,
	HelmRenderError,
	HelmVersionTooLow,
	RenderError,
} from "./RenderError";
export { render } from "./render";
export { KINDS, type Kind } from "./types";
export * as Yaml from "./yaml";
