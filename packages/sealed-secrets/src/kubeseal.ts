import { boundary, RenderError } from "@konfig.ts/core"
import { decodeYamlOutput, encryptWithCli } from "@konfig.ts/k8s"
import { Config, type Duration, Effect, Option } from "effect"
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
  encryptWithCli({
    bin: "kubeseal",
    args: _kubesealArgs(input),
    stdin: input.plainYaml,
    label: input.label,
    timeout: input.timeout
  })

export const parseSealed = (input: { readonly stdout: string; readonly label: string }) =>
  decodeYamlOutput({ text: input.stdout, label: input.label, what: "kubeseal failed", decode: _decodeSealedSecret })
