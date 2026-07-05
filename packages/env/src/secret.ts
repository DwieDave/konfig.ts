import { unsafeCoerce } from "@konfig.ts/core"
import { Config, type Redacted } from "effect"
import { _makeEntry, type EntryMarker, type EnvClaim, type HasEnvClaims } from "./entry"

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
  const keys = unsafeCoerce<Array<keyof E & string>>(
    Object.keys(input.env),
    "Object.keys of E returns the string keys of E, i.e. Array<keyof E & string>"
  )

  const fields: Record<string, Config.Config<Redacted.Redacted<string>>> = {}
  for (const key of keys) {
    fields[key] = Config.redacted(input.env[key])
  }

  const root = unsafeCoerce<
    Config.Config<
      {
        readonly [P in keyof E & string]: Redacted.Redacted<string>
      }
    >
  >(
    Config.all(fields),
    "Config.all over the per-key redacted fields yields a Config of the mapped record keyed by keyof E & string"
  )

  const envClaims: ReadonlyArray<EnvClaim> = keys.map((key) => ({
    envName: input.env[key],
    label: `Secret(${input.name}).${key}`
  }))

  return _makeEntry({
    config: root,
    metadata: {
      _kind: "Secret" as const,
      name: input.name,
      namespace: input.namespace,
      env: input.env,
      keys,
      fields: unsafeCoerce<
        {
          readonly [P in keyof E & string]: Config.Config<Redacted.Redacted<string>>
        }
      >(
        fields,
        "fields record was populated for every key in keys, matching the mapped type keyed by keyof E & string"
      ),
      envClaims
    }
  })
}

export type AnySecretEntry = SecretEntry<string, string, Readonly<Record<string, string>>>

/**
 * `Secret` value namespace (env-contracts package).
 *
 *   const dbCreds = Secret.define({
 *     name: "db-creds",
 *     namespace: "app",
 *     env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" },
 *   });
 *
 * The k8s package re-exports this merged with its own `Secret.make` /
 * `Secret.bind`, so importing `Secret` from `@konfig.ts/k8s` exposes
 * `define` alongside the manifest/binder constructors.
 */
export const Secret = {
  define: _define
}
