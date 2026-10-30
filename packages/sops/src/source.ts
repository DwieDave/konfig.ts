import type { parseYaml } from "@konfig.ts/core"
import type { SecretSource } from "@konfig.ts/env"
import { resolveByKey, SecretSourceError } from "@konfig.ts/env"
import { parseYamlWith } from "@konfig.ts/k8s"
import { Data, Effect, Predicate, Redacted } from "effect"
import type { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { sopsDecrypt } from "./sops"

type ParsedYaml = ReturnType<typeof parseYaml>

export interface SopsSourceInput<K extends string> {
  readonly file: string
  readonly keys: ReadonlyArray<K>
  /** Path resolver for the parsed plaintext object; default is flat `{key: value}`. */
  readonly extract?: (key: K, parsed: ParsedYaml) => ParsedYaml
}

class _SopsSource<K extends string> extends Data.TaggedClass("SecretSource")<{
  readonly keys: ReadonlyArray<K>
  readonly resolve: SecretSource<K, ChildProcessSpawner>["resolve"]
}> {}

const _defaultExtract = (key: string, parsed: ParsedYaml): ParsedYaml =>
  Predicate.isObject(parsed) && !Array.isArray(parsed) ? parsed[key] : undefined

const _asRedacted = (key: string, value: ParsedYaml) =>
  Predicate.isString(value)
    ? Effect.succeed(Redacted.make(value))
    : Effect.fail(
      new SecretSourceError({ source: "Sops", key, cause: `extracted value for "${key}" is not a string` })
    )

// Decrypts the file once; plucks every requested key from the in-memory plaintext.
const _source = <const K extends string>(
  input: SopsSourceInput<K>
): SecretSource<K, ChildProcessSpawner> => {
  const extract = input.extract ?? _defaultExtract

  const resolve = Effect.gen(function*() {
    const decryptedYaml = yield* sopsDecrypt({ file: input.file }).pipe(
      Effect.mapError(
        (cause) => new SecretSourceError({ source: "Sops", key: input.file, cause })
      )
    )

    const parsed = yield* parseYamlWith({
      text: decryptedYaml,
      onError: (cause) => new SecretSourceError({ source: "Sops", key: input.file, cause })
    })

    return yield* resolveByKey({
      keys: input.keys,
      resolve: (key) => _asRedacted(key, extract(key, parsed))
    })
  })

  return new _SopsSource({ keys: input.keys, resolve })
}

export const SopsSource = { source: _source }
