import { brand } from "@konfig.ts/core"
import type { SecretRef, SecretRefNamespace } from "@konfig.ts/core"
import { EnvVar, Secret } from "@konfig.ts/k8s"

type Expect<T extends true> = T

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

const dbCreds = Secret.make({
  name: "db-creds",
  namespace: "app",
  stringData: { url: "u", password: "p" }
})

type DbRef = typeof dbCreds.ref

type _DbNs = Expect<Equal<SecretRefNamespace<DbRef>, "app">>

const monitoringCreds = Secret.make({
  name: "grafana-token",
  namespace: "monitoring",
  stringData: { token: "..." }
})

type MonRef = typeof monitoringCreds.ref

type _MonNs = Expect<Equal<SecretRefNamespace<MonRef>, "monitoring">>

const _ok = EnvVar.secretEnv({ ref: dbCreds.ref, map: { DATABASE_URL: "url" }, podNamespace: "app" })

const _crossNs = EnvVar.secretEnv({
  ref: monitoringCreds.ref,
  map: { GRAFANA_TOKEN: "token" },
  // @ts-expect-error - podNamespace "app" does not match the ref's namespace "monitoring".
  podNamespace: "app"
})

const _backwards = EnvVar.secretEnv({
  ref: dbCreds.ref,
  map: { DB_URL: "url" },
  // @ts-expect-error - podNamespace "monitoring" does not match the ref's namespace "app".
  podNamespace: "monitoring"
})

const _keyTypo = EnvVar.secretEnv({
  ref: dbCreds.ref,
  // @ts-expect-error - "passowrd" is not in "url" | "password".
  map: { DATABASE_PASSWORD: "passowrd" },
  podNamespace: "app"
})

const opaque: SecretRef<"opaque"> = brand<SecretRef<"opaque">>("opaque")

const _anyPod = EnvVar.secretEnv({ ref: opaque, map: { OPAQUE: "anything" }, podNamespace: "some-pod" })

void _ok

void _crossNs

void _backwards

void _keyTypo

void _anyPod

export type _Tests = readonly [_DbNs, _MonNs]
