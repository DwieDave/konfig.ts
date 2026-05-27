import { Data } from "effect";

export class MonorepoRootNotFound extends Data.TaggedError("MonorepoRootNotFound")<{
	readonly from: string;
}> {}

export class WorkspaceNotFound extends Data.TaggedError("WorkspaceNotFound")<{
	readonly target: string;
}> {}

export class UnsupportedPm extends Data.TaggedError("UnsupportedPm")<{
	readonly reason: string;
	readonly candidates?: ReadonlyArray<string>;
}> {}

export class CircularWorkspaceDep extends Data.TaggedError("CircularWorkspaceDep")<{
	readonly cycle: ReadonlyArray<string>;
}> {}

export class EngineVersionMissing extends Data.TaggedError("EngineVersionMissing")<{
	readonly target: string;
	readonly engineField: string;
}> {}

export class SpecDecodeError extends Data.TaggedError("SpecDecodeError")<{
	readonly specPath: string;
	readonly cause: unknown;
}> {}

export class BuildScriptMissing extends Data.TaggedError("BuildScriptMissing")<{
	readonly target: string;
	readonly script: string;
}> {}

export class WorkspaceSourceUnknown extends Data.TaggedError("WorkspaceSourceUnknown")<{
	readonly target: string;
	readonly missingWorkspace: string;
}> {}

export class SharedRootFileMissing extends Data.TaggedError("SharedRootFileMissing")<{
	readonly target: string;
	readonly path: string;
}> {}

export class DockerWriteRefused extends Data.TaggedError("DockerWriteRefused")<{
	readonly path: string;
	readonly reason: string;
}> {}

export class DockerWriteError extends Data.TaggedError("DockerWriteError")<{
	readonly path: string;
	readonly cause: unknown;
}> {}

export type AnyDockerError =
	| MonorepoRootNotFound
	| WorkspaceNotFound
	| UnsupportedPm
	| CircularWorkspaceDep
	| EngineVersionMissing
	| SpecDecodeError
	| BuildScriptMissing
	| WorkspaceSourceUnknown
	| SharedRootFileMissing
	| DockerWriteRefused
	| DockerWriteError;
