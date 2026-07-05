import { runProcessString, unsafeCoerce } from "@konfig.ts/core"
import { Config, Data, Effect, Redacted, type Scope } from "effect"
import { ChildProcess, ChildProcessSpawner } from "./_unstable"

export class SecretSourceError extends Data.TaggedError("SecretSourceError")<{
  readonly source: string
  readonly key: string
  readonly cause: unknown
}> {}

export type ResolvedSecretValues<K extends string> = {
  readonly [P in K]: Redacted.Redacted<string>
}

export interface SecretSource<K extends string, R = never> {
  readonly _tag: "SecretSource"
  readonly keys: ReadonlyArray<K>
  readonly resolve: Effect.Effect<ResolvedSecretValues<K>, SecretSourceError, R>
}

export interface FromConfigInput<K extends string> {
  readonly keys: ReadonlyArray<K>
  readonly envName?: (key: K) => string
}

const _fromConfig = <const K extends string>(input: FromConfigInput<K>): SecretSource<K> => {
  const envName = input.envName ?? ((k: K) => k)
  const resolve = Effect.gen(function*() {
    const out: Record<string, Redacted.Redacted<string>> = {}
    for (const key of input.keys) {
      const v = yield* Config.redacted(envName(key)).pipe(
        Effect.mapError(
          (cause) => new SecretSourceError({ source: "fromConfig", key, cause })
        )
      )
      out[key] = v
    }
    return unsafeCoerce<ResolvedSecretValues<K>>(
      out,
      "per-key redacted record built from input.keys is the mapped type ResolvedSecretValues<K>"
    )
  })
  return { _tag: "SecretSource", keys: input.keys, resolve }
}

export interface LiteralInput<D extends Readonly<Record<string, string>>> {
  readonly data: D
}

const _literal = <const D extends Readonly<Record<string, string>>>(
  input: LiteralInput<D>
): SecretSource<keyof D & string> => {
  const keys = unsafeCoerce<Array<keyof D & string>>(
    Object.keys(input.data),
    "Object.keys of D returns the string keys of D, i.e. Array<keyof D & string>"
  )
  const resolve = Effect.sync(() => {
    const out: Record<string, Redacted.Redacted<string>> = {}
    for (const k of keys) {
      out[k] = Redacted.make(input.data[k])
    }
    return unsafeCoerce<ResolvedSecretValues<keyof D & string>>(
      out,
      "per-key redacted record built from keys is the mapped type ResolvedSecretValues<keyof D & string>"
    )
  })
  return { _tag: "SecretSource", keys, resolve }
}

export interface FromCommandSpec {
  readonly cmd: string
  readonly args: ReadonlyArray<string>
}

export interface FromCommandInput<K extends string> {
  readonly keys: ReadonlyArray<K>
  readonly run: (key: K) => FromCommandSpec
}

const _fromCommand = <const K extends string>(
  input: FromCommandInput<K>
): SecretSource<K, ChildProcessSpawner | Scope.Scope> => {
  const resolve = Effect.gen(function*() {
    const out: Record<string, Redacted.Redacted<string>> = {}
    for (const key of input.keys) {
      const spec = input.run(key)
      const proc = ChildProcess.make(spec.cmd, [...spec.args])
      const stdout = yield* runProcessString(proc, { allowEmptyStdout: false }).pipe(
        Effect.mapError(
          (cause) => new SecretSourceError({ source: "fromCommand", key, cause })
        )
      )
      const value = stdout.replace(/\n+$/u, "")
      if (value.length === 0) {
        return yield* Effect.fail(
          new SecretSourceError({
            source: "fromCommand",
            key,
            cause: "secret command produced empty output"
          })
        )
      }
      out[key] = Redacted.make(value)
    }
    return unsafeCoerce<ResolvedSecretValues<K>>(
      out,
      "per-key redacted record built from input.keys is the mapped type ResolvedSecretValues<K>"
    )
  }).pipe(Effect.scoped)
  return { _tag: "SecretSource", keys: input.keys, resolve }
}

export const SecretSource = {
  fromConfig: _fromConfig,
  literal: _literal,
  fromCommand: _fromCommand
}
