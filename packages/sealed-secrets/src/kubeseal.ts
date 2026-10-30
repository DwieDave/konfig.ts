import { boundary, parseYamlWith, RenderError, runProcessWithStdin } from "@konfig.ts/core"
import { type Duration, Effect, Option, Schema } from "effect"
import { Config } from "effect"
import { ChildProcess } from "effect/process"
import type { SealedSecretScope } from "./crd"
import { SealedSecretSchema } from "./schema"

const _decodeSealedSecret = boundary({
  schema: SealedSecretSchema,
  label: "SealedSecret"
})

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

export const runKubeseal = (input: {
  readonly plainYaml: string
  readonly certPath: string
  readonly scope: SealedSecretScope
  readonly timeout?: Duration.Input | undefined
  readonly label: string
}) =>
  runProcessWithStdin({
    command: ChildProcess.make("kubeseal", _kubesealArgs(input)),
    stdin: input.plainYaml,
    label: `${input.label}: kubeseal`,
    timeout: input.timeout
  }).pipe(
    Effect.catchTag("ProcessInvocationError", (cause) =>
      Effect.fail(new RenderError({ message: `${input.label}: kubeseal failed`, cause })))
  )

export const parseSealed = (input: { readonly stdout: string; readonly label: string }) =>
  parseYamlWith({
    text: input.stdout,
    schema: Schema.Unknown,
    onError: (cause) =>
      new RenderError({ message: `${input.label}: kubeseal failed — output was not valid YAML`, cause })
  }).pipe(Effect.flatMap(_decodeSealedSecret))
