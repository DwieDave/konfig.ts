export {
  type AnyDockerError,
  BuildScriptMissing,
  BunVersionUnsupported,
  CircularWorkspaceDep,
  DockerWriteError,
  DockerWriteRefused,
  EngineVersionMissing,
  MonorepoRootNotFound,
  PackageJsonInvalid,
  PlatformMultiUnsupported,
  SharedRootFileMissing,
  UnsupportedPm,
  WorkspaceNotFound,
  WorkspaceSourceUnknown
} from "./DockerError"

export { type DockerApp, DockerAppTypeId, isDockerApp, makeDockerApp } from "./Docker"

export type {
  Dockerfile,
  DockerfileBundle,
  From,
  HealthcheckIR,
  Instruction,
  PlatformIR,
  PlatformValue,
  Stage
} from "./ir/DockerfileIR"

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
  UserAtom
} from "./spec"

export type { ImageRef, NodeModulesLayout, PackageManager } from "./services/PackageManager"

export { bun as bunPm } from "./services/pm/bun"
export { npm as npmPm } from "./services/pm/npm"
export { pnpm as pnpmPm, type PnpmOptions } from "./services/pm/pnpm"
export { yarn as yarnPm, type YarnOptions } from "./services/pm/yarn"
export type { Runtime, RuntimeImageInput } from "./services/Runtime"
export { bun as bunRuntime } from "./services/runtime/bun"
export { node as nodeRuntime } from "./services/runtime/node"
export {
  allWorkspaces,
  type ClosureInput,
  closureOf,
  type DetectedPm,
  detectPm,
  findRoot,
  type PackageJson,
  type RootDir,
  type Workspace
} from "./services/WorkspaceGraph"

export { Docker } from "./Docker"
export { buildIR, type BuildIRInput, lower, type LowerContext, prepareContext, validateSpec } from "./ir/lower"
export { emit, type EmitInput, type EmittedDockerfiles } from "./render/emit"

export {
  type ExtractedHeader,
  extractHeader,
  HEADER_MARKER,
  renderFile,
  type RenderFileInput,
  renderHeader,
  type RenderHeaderInput,
  sha256Hex
} from "./render/header"
export { render } from "./render/Renderer"
