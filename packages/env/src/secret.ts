import { Config, type Redacted } from "effect"
import { allConfigsByKey, collectByKey, typedKeys } from "./_record"
import { _envClaim, _makeEntry, type EntryMarker, type EnvClaim, type HasEnvClaims } from "./entry"

export interface SecretEntry<
  N extends string,
  K extends string,
  E extends Readonly<Record<K, string>>
> extends Config.Config<{ readonly [P in K]: Redacted.Redacted<string> }>, EntryMarker<"Secret">, HasEnvClaims {
  readonly name: N
  readonly namespace: string
  readonly env: E
  readonly keys: ReadonlyArray<K>
  readonly fields: { readonly [P in K]: Config.Config<Redacted.Redacted<string>> }
}

export interface DefineSecretInput<
  N extends string,
  E extends Readonly<Record<string, string>>
> {
  readonly name: N
  readonly namespace: string
  readonly env: E
}

const _define = <
  const N extends string,
  const E extends Readonly<Record<string, string>>
>(
  input: DefineSecretInput<N, E>
): SecretEntry<N, keyof E & string, E> => {
  const keys = typedKeys(input.env)

  const fields = collectByKey({ keys, build: (key) => Config.Redacted(input.env[key]) })

  const root: Config.Config<{ readonly [P in keyof E & string]: Redacted.Redacted<string> }> = allConfigsByKey(fields)

  const envClaims: ReadonlyArray<EnvClaim> = keys.map((key) =>
    _envClaim({ envName: input.env[key], label: `Secret(${input.name}).${key}` })
  )

  return _makeEntry({
    config: root,
    metadata: {
      _kind: "Secret" as const,
      name: input.name,
      namespace: input.namespace,
      env: input.env,
      keys,
      fields,
      envClaims
    }
  })
}

export type AnySecretEntry = SecretEntry<string, string, Readonly<Record<string, string>>>

// @konfig.ts/k8s re-exports this merged with its own make/bind.
export const Secret = {
  define: _define
}
