import { Effect, Schema } from "effect"
import { BoundaryDecodeError } from "./RenderError"

export interface BoundaryInput<S extends Schema.Top> {
  readonly schema: S
  readonly label?: string
}
export const boundary =
  <S extends Schema.Top>(input: BoundaryInput<S>) =>
  (value: unknown): Effect.Effect<S["Type"], BoundaryDecodeError, S["DecodingServices"]> =>
    Schema.decodeUnknownEffect(input.schema)(value).pipe(
      Effect.mapError(
        (cause) =>
          new BoundaryDecodeError({
            schema: input.label ?? "boundary",
            cause
          })
      )
    )
