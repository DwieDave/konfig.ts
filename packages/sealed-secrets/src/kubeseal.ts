import { boundary, type BoundaryDecodeError, parseYamlWith, processDetail, runProcessWithStdin } from "@konfig.ts/core"
import { Config, Data, type Duration, Effect, Option, Schema } from "effect"
import { ChildProcess } from "effect/process"
import type { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { type SealedSecret, SealedSecretSchema, type SealedSecretScope } from "./schema"

export class KubesealCertMissing extends Data.TaggedError("KubesealCertMissing")<{
  readonly hint: string
}> {
  get message(): string {
    return `kubeseal cert not provided — pass opts.certPath or set $KUBESEAL_CERT (${this.hint})`
  }
}

export class KubesealInvocationError extends Data.TaggedError("KubesealInvocationError")<{
  readonly cause: unknown
}> {
  get message(): string {
    return `kubeseal invocation failed${processDetail(this.cause)}`
  }
}

export class KubesealParseError extends Data.TaggedError("KubesealParseError")<{
  readonly output: string
  readonly cause: unknown
}> {
  get message(): string {
    return `kubeseal output failed to parse as YAML: ${String(this.cause)}`
  }
}

export type KubesealFailure = KubesealInvocationError | KubesealParseError | BoundaryDecodeError

export interface RunKubesealInput {
  readonly plainSecretYaml: string
  readonly certPath: string
  readonly scope: SealedSecretScope
  readonly timeout?: Duration.Input | undefined
}

export const _kubesealArgs = (input: { readonly certPath: string; readonly scope: SealedSecretScope }): string[] => [
  "--cert",
  input.certPath,
  "--scope",
  input.scope,
  "--format",
  "yaml"
]

const _nonEmpty = (value: string | undefined): Option.Option<string> =>
  Option.filter(Option.fromNullishOr(value), (text) => text.length > 0)

export const resolveCertPath = (input: {
  readonly certPath?: string | undefined
}): Effect.Effect<string, KubesealCertMissing> =>
  Option.match(_nonEmpty(input.certPath), {
    onSome: Effect.succeed,
    onNone: () =>
      Config.String("KUBESEAL_CERT").pipe(
        Config.option,
        Effect.orDie,
        Effect.map(Option.flatMap(_nonEmpty)),
        Effect.flatMap(Option.match({
          onSome: Effect.succeed,
          onNone: () => Effect.fail(new KubesealCertMissing({ hint: "checked opts.certPath, then $KUBESEAL_CERT" }))
        }))
      )
  })

const _decodeSealedSecret = boundary({ schema: SealedSecretSchema, label: "SealedSecret" })

const _parse = (output: string): Effect.Effect<SealedSecret, KubesealParseError | BoundaryDecodeError> =>
  parseYamlWith({ text: output, schema: Schema.Unknown, onError: (cause) => new KubesealParseError({ output, cause }) })
    .pipe(Effect.flatMap(_decodeSealedSecret))

export const runKubeseal = (
  input: RunKubesealInput
): Effect.Effect<SealedSecret, KubesealFailure, ChildProcessSpawner> =>
  runProcessWithStdin({
    command: ChildProcess.make("kubeseal", _kubesealArgs(input)),
    stdin: input.plainSecretYaml,
    label: "kubeseal",
    timeout: input.timeout
  }).pipe(
    Effect.mapError((error) => new KubesealInvocationError({ cause: error.cause })),
    Effect.flatMap(_parse)
  )
