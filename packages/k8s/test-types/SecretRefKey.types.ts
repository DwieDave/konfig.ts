// Compile-time assertions for `SecretRef<N, K>` key narrowing.
//
// `EnvVar.fromSecret({ ref, key })` constrains `key` to the union K carried by
// the ref. `Secret.make({ stringData })` infers K from the literal record
// keys; `Environment.bind`'s secret members carry K from `Secret`.

import type { SecretRef, SecretRefKeys, SecretRefName } from "@konfig.ts/core"
import { EnvVar, Secret } from "@konfig.ts/k8s"

type Expect<T extends true> = T
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

// 1 · SecretRef defaults K to `string` — back-compat for unkeyed callers.
type RefDefault = SecretRef<"db-creds">
type _DefaultK = Expect<Equal<SecretRefKeys<RefDefault>, string>>
type _DefaultN = Expect<Equal<SecretRefName<RefDefault>, "db-creds">>

// 2 · A typed ref carries the key union.
type RefTyped = SecretRef<"db-creds", "url" | "username" | "password">
type _TypedK = Expect<Equal<SecretRefKeys<RefTyped>, "url" | "username" | "password">>

// 3 · `Secret.make` infers K from the literal keys of `stringData`.
const dbCreds = Secret.make({
  name: "db-creds",
  namespace: "prod",
  stringData: { url: "u", username: "x", password: "p" }
})
type DbCredsRef = typeof dbCreds.ref
type _DbCredsK = Expect<Equal<SecretRefKeys<DbCredsRef>, "url" | "username" | "password">>
type _DbCredsN = Expect<Equal<SecretRefName<DbCredsRef>, "db-creds">>

// 4 · `EnvVar.fromSecret` accepts a declared key.
const _ok = EnvVar.fromSecret({ name: "DATABASE_URL", ref: dbCreds.ref, key: "url" })

// 5 · `EnvVar.fromSecret` rejects a typo on a typed ref.
const _typo = EnvVar.fromSecret({
  name: "DATABASE_PASSWORD",
  ref: dbCreds.ref,
  // @ts-expect-error - "passowrd" is not in "url" | "username" | "password".
  key: "passowrd"
})

// 6 · `EnvVar.fromSecret` rejects a key from a sibling secret.
const s3 = Secret.make({
  name: "s3-creds",
  namespace: "prod",
  stringData: { accessKey: "a", secretKey: "s" }
})
const _cross = EnvVar.fromSecret({
  name: "MISWIRED",
  ref: s3.ref,
  // @ts-expect-error - "url" is not in "accessKey" | "secretKey".
  key: "url"
})

// 7 · Unkeyed (default K=string) ref still accepts any string.
const opaque: SecretRef<"opaque"> = "opaque" as SecretRef<"opaque">
const _anyKey = EnvVar.fromSecret({ name: "OPAQUE", ref: opaque, key: "anything" })

void _ok
void _typo
void _cross
void _anyKey

export type _Tests = readonly [_DefaultK, _DefaultN, _TypedK, _DbCredsK, _DbCredsN]
