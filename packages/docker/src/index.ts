export {
  type AnyDockerError,
  BuildScriptMissing,
  BunVersionUnsupported,
  CircularWorkspaceDep,
  DockerWriteError,
  DockerWriteRefused,
  EngineVersionInvalid,
  EngineVersionMissing,
  MonorepoRootNotFound,
  PackageJsonInvalid,
  PmRuntimeIncompatible,
  SharedRootFileMissing,
  SpecDecodeError,
  SpecInvalid,
  UnsupportedPm,
  UnsupportedYarnLinker,
  WorkspaceConfigInvalid,
  WorkspaceNotFound,
  WorkspaceSourceUnknown
} from "./DockerError"

export { Docker, type DockerApp, DockerAppTypeId, isDockerApp, makeDockerApp } from "./Docker"

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
  lookupWorkspace,
  type PackageJson,
  type RootDir,
  type Workspace,
  workspaceDeps
} from "./services/WorkspaceGraph"

export {
  buildIR,
  type BuildIRInput,
  lower,
  type LowerContext,
  type LowerInput,
  prepareContext,
  validateSpec
} from "./ir/lower"

export { emit, type EmitInput, type EmittedDockerfiles } from "./render/emit"

export {
  type ExtractedHeader,
  extractHeader,
  HEADER_MARKER,
  PACKAGE_NAME,
  renderFile,
  type RenderFileInput,
  renderHeader,
  type RenderHeaderInput
} from "./render/header"

export { render } from "./render/Renderer"

export { sha256Hex } from "@konfig.ts/core"
