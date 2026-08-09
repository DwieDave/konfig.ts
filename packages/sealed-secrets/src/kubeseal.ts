import { boundary, processDetail, ProcessError, runProcessString } from "@konfig.ts/core"
import { Config, Data, Effect, Option, Stream } from "effect"
import * as YAML from "yaml"
import { ChildProcess } from "./_unstable"
import type { SealedSecretScope } from "./crd"
import { SealedSecretSchema } from "./schema"

const _decodeSealedSecret = boundary({
  schema: SealedSecretSchema,
  label: "SealedSecret"
})

export class KubesealCertMissing extends Data.TaggedError("KubesealCertMissing")<{
  readonly hint: string
}> {
  get message(): string {
    return `kubeseal cert not provided — pass opts.certPath or set $KUBESEAL_CERT (${this.hint})`
  }
}

export class KubesealInvocationError extends Data.TaggedError("KubesealInvocationError")<{
  readonly cause: ProcessError
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

export interface RunKubesealInput {
  readonly plainSecretYaml: string
  readonly certPath: string
  readonly scope: SealedSecretScope
}

export const resolveCertPath = (
  input: { readonly certPath?: string }
): Effect.Effect<string, KubesealCertMissing> =>
  Effect.gen(function*() {
    const fromOpt = input.certPath
    if (fromOpt !== undefined && fromOpt.length > 0) return fromOpt
    const fromEnv = yield* Config.string("KUBESEAL_CERT").pipe(Config.option, Effect.orDie)
    if (Option.isSome(fromEnv) && fromEnv.value.length > 0) return fromEnv.value
    return yield* new KubesealCertMissing({ hint: "checked opts.certPath, then $KUBESEAL_CERT" })
  })

export const runKubeseal = (input: RunKubesealInput) =>
  Effect.gen(function*() {
    const encoded = new TextEncoder().encode(input.plainSecretYaml)
    const cmd = ChildProcess.make(
      "kubeseal",
      ["--cert", input.certPath, "--scope", input.scope, "--format", "yaml"],
      { stdin: Stream.succeed(encoded) }
    )
    const stdout = yield* runProcessString(cmd).pipe(
      Effect.mapError((cause) => new KubesealInvocationError({ cause }))
    )
    const parsed = yield* Effect.try({
      try: (): unknown => YAML.parse(stdout),
      catch: (cause) => new KubesealParseError({ output: stdout, cause })
    })
    return yield* _decodeSealedSecret(parsed)
  }).pipe(Effect.scoped)
