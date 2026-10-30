import { Data, type PlatformError } from "effect"

export class MonorepoRootNotFound extends Data.TaggedError("MonorepoRootNotFound")<{
  readonly from: string
}> {}

export class WorkspaceNotFound extends Data.TaggedError("WorkspaceNotFound")<{
  readonly target: string
}> {}

export class PackageJsonInvalid extends Data.TaggedError("PackageJsonInvalid")<{
  readonly path: string
  readonly cause: unknown
}> {}

export class UnsupportedPm extends Data.TaggedError("UnsupportedPm")<{
  readonly reason: string
  readonly candidates?: ReadonlyArray<string>
}> {}

export class CircularWorkspaceDep extends Data.TaggedError("CircularWorkspaceDep")<{
  readonly cycle: ReadonlyArray<string>
}> {
  override get message(): string {
    return `circular workspace dependency: ${this.cycle.join(" -> ")}`
  }
}

export class EngineVersionMissing extends Data.TaggedError("EngineVersionMissing")<{
  readonly target: string
  readonly engineField: string
}> {}

export class EngineVersionInvalid extends Data.TaggedError("EngineVersionInvalid")<{
  readonly target: string
  readonly engineField: string
  readonly value: string
}> {}

export class WorkspaceConfigInvalid extends Data.TaggedError("WorkspaceConfigInvalid")<{
  readonly path: string
  readonly cause: unknown
}> {}

export class BunVersionUnsupported extends Data.TaggedError("BunVersionUnsupported")<{
  readonly target: string
  readonly version: string
  readonly minimum: string
}> {}

export class BuildScriptMissing extends Data.TaggedError("BuildScriptMissing")<{
  readonly target: string
  readonly script: string
}> {}

export class WorkspaceSourceUnknown extends Data.TaggedError("WorkspaceSourceUnknown")<{
  readonly target: string
  readonly missingWorkspace: string
}> {}

export class SharedRootFileMissing extends Data.TaggedError("SharedRootFileMissing")<{
  readonly target: string
  readonly path: string
}> {}

export class SpecInvalid extends Data.TaggedError("SpecInvalid")<{
  readonly cause: unknown
}> {}

export class UnsupportedYarnLinker extends Data.TaggedError("UnsupportedYarnLinker")<{
  readonly linker: string
}> {}

export class PmRuntimeIncompatible extends Data.TaggedError("PmRuntimeIncompatible")<{
  readonly pm: string
  readonly runtime: string
}> {}

export type AnyDockerError =
  | PlatformError.PlatformError
  | SpecInvalid
  | MonorepoRootNotFound
  | WorkspaceNotFound
  | PackageJsonInvalid
  | UnsupportedPm
  | CircularWorkspaceDep
  | EngineVersionMissing
  | EngineVersionInvalid
  | WorkspaceConfigInvalid
  | BunVersionUnsupported
  | BuildScriptMissing
  | WorkspaceSourceUnknown
  | SharedRootFileMissing
  | UnsupportedYarnLinker
  | PmRuntimeIncompatible
