import type { SecretSource } from "@konfig.ts/env"
import { collectByKey, SecretSourceError } from "@konfig.ts/env"
import { Effect, Redacted } from "effect"
import * as YAML from "yaml"
import type { ChildProcessSpawner } from "./_unstable"
import { sopsDecrypt } from "./sops"

export interface SopsSourceInput<K extends string> {
  readonly file: string
  readonly keys: ReadonlyArray<K>
  /** Path resolver for the parsed plaintext object; default is flat `{key: value}`. */
  readonly extract?: (key: K, parsed: unknown) => unknown
}

const _hasKey = <K extends string>(obj: object, key: K): obj is { readonly [P in K]: unknown } => key in obj

const _defaultExtract = (key: string, parsed: unknown): unknown => {
  if (parsed === null || typeof parsed !== "object") return undefined
  return _hasKey(parsed, key) ? parsed[key] : undefined
}

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
    const parsed = yield* Effect.try({
      try: (): unknown => YAML.parse(decryptedYaml),
      catch: (cause) => new SecretSourceError({ source: "Sops", key: input.file, cause })
    })
    const out: Record<string, Redacted.Redacted<string>> = {}
    for (const key of input.keys) {
      const value = extract(key, parsed)
      if (typeof value !== "string") {
        return yield* new SecretSourceError({
          source: "Sops",
          key,
          cause: `extracted value for "${key}" is not a string`
        })
      }
      out[key] = Redacted.make(value)
    }
    return collectByKey({ keys: input.keys, build: (key) => out[key] })
  })
  return { _tag: "SecretSource", keys: input.keys, resolve }
}

export const SopsSource = { source: _source }
