import { parseYamlWith, unsafeCoerce } from "@konfig.ts/core"
import { type ResolvedSecretValues, type SecretSource, SecretSourceError } from "@konfig.ts/env"
import { Data, Effect, Predicate, Redacted, Schema } from "effect"
import type { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { sopsDecrypt } from "./sops"

export interface SopsSourceInput<K extends string> {
  readonly file: string
  readonly keys: ReadonlyArray<K>
  /** Plucks a key's value from the decrypted document; the default is a flat `{ key: value }` lookup. */
  readonly extract?: (key: K, parsed: Schema.Json) => Schema.Json | undefined
}

const _SOURCE = "Sops"

const _JsonRecord = Schema.Record(Schema.String, Schema.Json)

class _SopsSource<K extends string> extends Data.TaggedClass("SecretSource")<{
  readonly keys: ReadonlyArray<K>
  readonly resolve: Effect.Effect<ResolvedSecretValues<K>, SecretSourceError, ChildProcessSpawner>
}> {}

const _flatLookup = (input: { readonly key: string; readonly parsed: Schema.Json }): Schema.Json | undefined =>
  Schema.is(_JsonRecord)(input.parsed) ? input.parsed[input.key] : undefined

const _decrypt = (file: string): Effect.Effect<Schema.Json, SecretSourceError, ChildProcessSpawner> =>
  sopsDecrypt({ file }).pipe(
    Effect.mapError((cause) => new SecretSourceError({ source: _SOURCE, key: file, cause })),
    Effect.flatMap((text) =>
      parseYamlWith({
        text,
        schema: Schema.Json,
        onError: (cause) => new SecretSourceError({ source: _SOURCE, key: file, cause })
      })
    )
  )

const _pluck = <K extends string>(input: { readonly key: K; readonly value: Schema.Json | undefined }) =>
  Predicate.isString(input.value)
    ? Effect.succeed<readonly [K, Redacted.Redacted<string>]>([input.key, Redacted.make(input.value)])
    : Effect.fail(
      new SecretSourceError({
        source: _SOURCE,
        key: input.key,
        cause: `extracted value for "${input.key}" is not a string`
      })
    )

const _byKey = <K extends string>(
  entries: ReadonlyArray<readonly [K, Redacted.Redacted<string>]>
): ResolvedSecretValues<K> =>
  unsafeCoerce<ResolvedSecretValues<K>>({
    value: Object.fromEntries(entries),
    reason: "one entry per requested key K, so the record is exactly ResolvedSecretValues<K>"
  })

const _extract = <K extends string>(
  input: { readonly source: SopsSourceInput<K>; readonly key: K; readonly parsed: Schema.Json }
): Schema.Json | undefined =>
  input.source.extract === undefined ? _flatLookup(input) : input.source.extract(input.key, input.parsed)

const _source = <const K extends string>(input: SopsSourceInput<K>): SecretSource<K, ChildProcessSpawner> => {
  const resolve = _decrypt(input.file).pipe(
    Effect.flatMap((parsed) =>
      Effect.forEach(input.keys, (key) => _pluck({ key, value: _extract({ source: input, key, parsed }) }))
    ),
    Effect.map(_byKey)
  )

  return new _SopsSource({ keys: input.keys, resolve })
}

export const SopsSource = { source: _source }
