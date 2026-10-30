import { runProcessString } from "@konfig.ts/core"
import { Config, Data, Effect, Redacted } from "effect"
import { ChildProcess } from "effect/process"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { collectByKey, resolveByKey, typedKeys } from "./_record"

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

class _Source<K extends string, R> extends Data.TaggedClass("SecretSource")<{
  readonly keys: ReadonlyArray<K>
  readonly resolve: Effect.Effect<ResolvedSecretValues<K>, SecretSourceError, R>
}> {}

const _source = <K extends string, R>(input: {
  readonly keys: ReadonlyArray<K>
  readonly resolve: Effect.Effect<ResolvedSecretValues<K>, SecretSourceError, R>
}): SecretSource<K, R> => new _Source(input)

export interface FromConfigInput<K extends string> {
  readonly keys: ReadonlyArray<K>
  readonly envName?: (key: K) => string
}

const _fromConfig = <const K extends string>(input: FromConfigInput<K>): SecretSource<K> => {
  const envName = input.envName ?? ((k: K) => k)

  const resolve = resolveByKey({
    keys: input.keys,
    resolve: (key) =>
      Config.Redacted(envName(key)).pipe(
        Effect.mapError((cause) => new SecretSourceError({ source: "fromConfig", key, cause }))
      )
  })

  return _source({ keys: input.keys, resolve })
}

export interface LiteralInput<D extends Readonly<Record<string, string>>> {
  readonly data: D
}

const _literal = <const D extends Readonly<Record<string, string>>>(
  input: LiteralInput<D>
): SecretSource<keyof D & string> => {
  const keys = typedKeys(input.data)
  const resolve = Effect.sync(() => collectByKey({ keys, build: (key) => Redacted.make(input.data[key]) }))

  return _source({ keys, resolve })
}

export interface FromCommandSpec {
  readonly cmd: string
  readonly args: ReadonlyArray<string>
}

export interface FromCommandInput<K extends string> {
  readonly keys: ReadonlyArray<K>
  readonly run: (key: K) => FromCommandSpec
}

const _runCommand = (spec: FromCommandSpec, key: string) =>
  runProcessString(ChildProcess.make(spec.cmd, [...spec.args]), { allowEmptyStdout: true }).pipe(
    Effect.mapError((cause) => new SecretSourceError({ source: "fromCommand", key, cause })),
    Effect.map((stdout) => stdout.trim()),
    Effect.filterOrFail(
      (value) => value.length > 0,
      () => new SecretSourceError({ source: "fromCommand", key, cause: "secret command produced empty output" })
    ),
    Effect.map((value) => Redacted.make(value))
  )

const _fromCommand = <const K extends string>(
  input: FromCommandInput<K>
): SecretSource<K, ChildProcessSpawner> => {
  const resolve = resolveByKey({ keys: input.keys, resolve: (key) => _runCommand(input.run(key), key) })

  return _source({ keys: input.keys, resolve })
}

export const SecretSource = {
  fromConfig: _fromConfig,
  literal: _literal,
  fromCommand: _fromCommand
}
