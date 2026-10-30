import { RenderError } from "@konfig.ts/core"
import type { ResolvedSecretValues, SecretSource } from "@konfig.ts/env"
import { Effect } from "effect"

export const resolveSource = <K extends string, R>(input: {
  readonly source: SecretSource<K, R>
  readonly label: string
}): Effect.Effect<ResolvedSecretValues<K>, RenderError, R> =>
  input.source.resolve.pipe(
    Effect.mapError(
      (cause) =>
        new RenderError({
          message: `${input.label}: source failed for key "${cause.key}"`,
          cause
        })
    )
  )
