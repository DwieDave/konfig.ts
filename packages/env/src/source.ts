import { runProcessString } from "@konfig.ts/core"
import { Config, Data, Effect, Redacted } from "effect"
import { collectByKey, typedKeys } from "./_record"
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
      out[key] = yield* Config.Redacted(envName(key)).pipe(
        Effect.mapError(
          (cause) => new SecretSourceError({ source: "fromConfig", key, cause })
        )
      )
    }
    return collectByKey({ keys: input.keys, build: (key) => out[key] })
  })
  return { _tag: "SecretSource", keys: input.keys, resolve }
}

export interface LiteralInput<D extends Readonly<Record<string, string>>> {
  readonly data: D
}

const _literal = <const D extends Readonly<Record<string, string>>>(
  input: LiteralInput<D>
): SecretSource<keyof D & string> => {
  const keys = typedKeys(input.data)
  const resolve = Effect.sync(() => collectByKey({ keys, build: (key) => Redacted.make(input.data[key]) }))
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
): SecretSource<K, ChildProcessSpawner> => {
  const resolve = Effect.gen(function*() {
    const out: Record<string, Redacted.Redacted<string>> = {}
    for (const key of input.keys) {
      const spec = input.run(key)
      const proc = ChildProcess.make(spec.cmd, [...spec.args])
      const stdout = yield* runProcessString(proc, { allowEmptyStdout: true }).pipe(
        Effect.mapError(
          (cause) => new SecretSourceError({ source: "fromCommand", key, cause })
        )
      )
      const value = stdout.trim()
      if (value.length === 0) {
        return yield* new SecretSourceError({
          source: "fromCommand",
          key,
          cause: "secret command produced empty output"
        })
      }
      out[key] = Redacted.make(value)
    }
    return collectByKey({ keys: input.keys, build: (key) => out[key] })
  })
  return { _tag: "SecretSource", keys: input.keys, resolve }
}

export const SecretSource = {
  fromConfig: _fromConfig,
  literal: _literal,
  fromCommand: _fromCommand
}
