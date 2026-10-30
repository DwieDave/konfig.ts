import { RenderError } from "@konfig.ts/core"
import { Config, Effect, Option } from "effect"
import type { SealedSecretScope } from "./schema"

export const _kubesealArgs = (input: { readonly certPath: string; readonly scope: SealedSecretScope }): string[] => [
  "--cert",
  input.certPath,
  "--scope",
  input.scope,
  "--format",
  "yaml"
]

export const resolveCertPath = (input: {
  readonly certPath?: string | undefined
  readonly label: string
}): Effect.Effect<string, RenderError> =>
  Effect.gen(function*() {
    if (input.certPath !== undefined && input.certPath.length > 0) return input.certPath
    const fromEnv = yield* Config.String("KUBESEAL_CERT").pipe(Config.option, Effect.orDie)

    if (Option.isSome(fromEnv) && fromEnv.value.length > 0) return fromEnv.value

    return yield* new RenderError({
      message: `${input.label}: cert missing — pass opts.certPath or set $KUBESEAL_CERT`
    })
  })
