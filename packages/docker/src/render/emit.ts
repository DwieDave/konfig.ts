import { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import type { Path } from "effect/Path";
import type { AnyDockerError } from "../DockerError";
import { lower } from "../ir/lower";
import type { DockerSpec } from "../spec";
import { renderFile } from "./header";
import { render } from "./Renderer";

export interface EmittedDockerfiles {
	readonly dockerfile: string;
	readonly dockerfileDev?: string;
}

export interface EmitInput {
	readonly spec: DockerSpec;
	readonly specPath: string;
}

export const emit = (
	input: EmitInput,
): Effect.Effect<EmittedDockerfiles, AnyDockerError, FileSystem | Path> =>
	Effect.gen(function* () {
		const bundle = yield* lower(input.spec);
		const dockerfile = renderFile({ specPath: input.specPath, body: render(bundle.prod) });
		if (!bundle.dev) return { dockerfile };
		const dockerfileDev = renderFile({
			specPath: input.specPath,
			body: render(bundle.dev),
		});
		return { dockerfile, dockerfileDev };
	});
