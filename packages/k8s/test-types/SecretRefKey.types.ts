import type { SecretRef, SecretRefKeys, SecretRefName } from "@konfig.ts/core"
import { EnvVar, Secret } from "@konfig.ts/k8s"

type Expect<T extends true> = T
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

type RefDefault = SecretRef<"db-creds">
type _DefaultK = Expect<Equal<SecretRefKeys<RefDefault>, string>>
type _DefaultN = Expect<Equal<SecretRefName<RefDefault>, "db-creds">>

type RefTyped = SecretRef<"db-creds", "url" | "username" | "password">
type _TypedK = Expect<Equal<SecretRefKeys<RefTyped>, "url" | "username" | "password">>

const dbCreds = Secret.make({
  name: "db-creds",
  namespace: "prod",
  stringData: { url: "u", username: "x", password: "p" }
})
type DbCredsRef = typeof dbCreds.ref
type _DbCredsK = Expect<Equal<SecretRefKeys<DbCredsRef>, "url" | "username" | "password">>
type _DbCredsN = Expect<Equal<SecretRefName<DbCredsRef>, "db-creds">>

const _ok = EnvVar.fromSecret({ name: "DATABASE_URL", ref: dbCreds.ref, key: "url" })

const _typo = EnvVar.fromSecret({
  name: "DATABASE_PASSWORD",
  ref: dbCreds.ref,
  // @ts-expect-error - "passowrd" is not in "url" | "username" | "password".
  key: "passowrd"
})

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

const opaque: SecretRef<"opaque"> = "opaque" as SecretRef<"opaque">
const _anyKey = EnvVar.fromSecret({ name: "OPAQUE", ref: opaque, key: "anything" })

void _ok
void _typo
void _cross
void _anyKey

export type _Tests = readonly [_DefaultK, _DefaultN, _TypedK, _DbCredsK, _DbCredsN]
