
export const PACKAGE_NAME = "@konfig.ts/docker";

export {
	type AnyDockerError,
	BuildScriptMissing,
	CircularWorkspaceDep,
	DockerWriteError,
	DockerWriteRefused,
	EngineVersionMissing,
	MonorepoRootNotFound,
	SharedRootFileMissing,
	SpecDecodeError,
	UnsupportedPm,
	WorkspaceNotFound,
	WorkspaceSourceUnknown,
} from "./DockerError";

export {
	type DockerApp,
	DockerAppTypeId,
	isDockerApp,
	makeDockerApp,
} from "./Docker";

export type {
	Arg,
	Dockerfile,
	DockerfileBundle,
	From,
	HealthcheckIR,
	Instruction,
	PlatformIR,
	PlatformValue,
	Stage,
} from "./ir/DockerfileIR";

export {
	BuildAtom,
	CopyAtom,
	decodeDockerSpec,
	decodeDockerSpecSync,
	DevSpec,
	DockerSpec,
	HealthcheckAtom,
	PackageManagerAtom,
	PlatformAtom,
	RunnerSpec,
	RuntimeAtom,
	UserAtom,
} from "./spec";

export type {
	DepsImageInput,
	ImageRef,
	NodeModulesLayout,
	PackageManager,
} from "./services/PackageManager";

export {
	allWorkspaces,
	type ClosureInput,
	closureOf,
	type DetectedPm,
	detectPm,
	findRoot,
	type PackageJson,
	type RootDir,
	type Workspace,
} from "./services/WorkspaceGraph";
export { bun as bunPm } from "./services/pm/bun";
export { npm as npmPm } from "./services/pm/npm";
export { pnpm as pnpmPm, type PnpmOptions } from "./services/pm/pnpm";
export type { Runtime, RuntimeImageInput } from "./services/Runtime";
export { bun as bunRuntime } from "./services/runtime/bun";
export { node as nodeRuntime } from "./services/runtime/node";

export { buildIR, type BuildIRInput, lower, type LowerContext, prepareContext, validateSpec } from "./ir/lower";
export { Docker } from "./Docker";
export { emit, type EmitInput, type EmittedDockerfiles } from "./render/emit";

export { render } from "./render/Renderer";
export {
	type ExtractedHeader,
	extractHeader,
	HEADER_MARKER,
	type RenderFileInput,
	type RenderHeaderInput,
	renderFile,
	renderHeader,
	sha256Hex,
} from "./render/header";
