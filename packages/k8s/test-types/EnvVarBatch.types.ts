import type { SecretRef } from "@konfig.ts/core"
import { ConfigMap, EnvVar, Secret, SecretRef as SecretRefValue } from "@konfig.ts/k8s"

type Expect<T extends true> = T
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

const dbCreds = Secret.make({
  name: "db-creds",
  namespace: "prod",
  stringData: { url: "u", password: "p" }
})

const vars = EnvVar.secretEnv(dbCreds.ref, { DATABASE_URL: "url", DATABASE_PASSWORD: "password" })
type _Names = Expect<Equal<(typeof vars)[number]["name"], "DATABASE_URL" | "DATABASE_PASSWORD">>

const _nsOk = EnvVar.secretEnv(dbCreds.ref, { DATABASE_URL: "url" }, { podNamespace: "prod" })

const _keyTypo = EnvVar.secretEnv(dbCreds.ref, {
  // @ts-expect-error - "passowrd" is not in "url" | "password".
  DATABASE_PASSWORD: "passowrd"
})

// @ts-expect-error - podNamespace "staging" does not match the ref's namespace "prod".
const _nsMismatch = EnvVar.secretEnv(dbCreds.ref, { DATABASE_URL: "url" }, { podNamespace: "staging" })

// @ts-expect-error - raw string is not a SecretRef.
const _rawRef = EnvVar.secretEnv("db-creds", { DATABASE_URL: "url" })

const opaque: SecretRef<"opaque"> = "opaque" as SecretRef<"opaque">
const _anyKey = EnvVar.secretEnv(SecretRefValue.unsafeReNamespace(opaque), { OPAQUE: "anything" }, {
  podNamespace: "some-pod"
})

const cfg = ConfigMap.make({ name: "cfg", namespace: "prod", data: { HOST: "h", PORT: "1" } })
const cfgVars = EnvVar.configMapEnv(cfg.ref, { DB_HOST: "HOST", DB_PORT: "PORT" })
type _CfgNames = Expect<Equal<(typeof cfgVars)[number]["name"], "DB_HOST" | "DB_PORT">>

const _cfgTypo = EnvVar.configMapEnv(cfg.ref, {
  // @ts-expect-error - "PROT" is not in "HOST" | "PORT".
  DB_PORT: "PROT"
})

void _nsOk
void _keyTypo
void _nsMismatch
void _rawRef
void _anyKey
void _cfgTypo

export type _Tests = readonly [_Names, _CfgNames]
