import { Effect, Schema } from "effect";
import { BoundaryDecodeError } from "./RenderError";

// Run a Schema decode at a module boundary. Wraps `decodeUnknownEffect` so the
// caller gets a tagged `BoundaryDecodeError` (instead of effect's SchemaError),
// matching the rest of the @tsk error surface and letting Effect.catchTag work.
export const boundary =
	<S extends Schema.Top>(schema: S, label?: string) =>
	(input: unknown): Effect.Effect<S["Type"], BoundaryDecodeError, S["DecodingServices"]> =>
		Schema.decodeUnknownEffect(schema)(input).pipe(
			Effect.mapError(
				(cause) =>
					new BoundaryDecodeError({
						schema: label ?? "boundary",
						cause,
					}),
			),
		);
