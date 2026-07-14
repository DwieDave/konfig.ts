// Compile-time assertions for `ConfigMapRef<N, K>` key narrowing —
// the configmap-side parallel to `SecretRef<N, K>`.

import type { ConfigMapRef, ConfigMapRefKeys, ConfigMapRefName } from "@konfig.ts/core"
import { ConfigMap, EnvVar } from "@konfig.ts/k8s"

type Expect<T extends true> = T
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

// 1 · Default K is `string` (back-compat for unkeyed callers).
type RefDefault = ConfigMapRef<"app-config">
type _DefaultK = Expect<Equal<ConfigMapRefKeys<RefDefault>, string>>
type _DefaultN = Expect<Equal<ConfigMapRefName<RefDefault>, "app-config">>

// 2 · Typed ref carries the key union.
type RefTyped = ConfigMapRef<"app-config", "HOST" | "PORT" | "LOG_LEVEL">
type _TypedK = Expect<Equal<ConfigMapRefKeys<RefTyped>, "HOST" | "PORT" | "LOG_LEVEL">>

// 3 · `ConfigMap.make` infers K from the literal keys of `data`.
const cfg = ConfigMap.make({
  name: "app-config",
  namespace: "prod",
  data: { HOST: "db.prod", PORT: "5432", LOG_LEVEL: "info" }
})
type CfgRef = typeof cfg.ref
type _CfgK = Expect<Equal<ConfigMapRefKeys<CfgRef>, "HOST" | "PORT" | "LOG_LEVEL">>
type _CfgN = Expect<Equal<ConfigMapRefName<CfgRef>, "app-config">>

// 4 · `EnvVar.fromConfigMap` accepts a declared key.
const _ok = EnvVar.fromConfigMap({ name: "DB_HOST", ref: cfg.ref, key: "HOST" })

// 5 · `EnvVar.fromConfigMap` rejects a typo on a typed ref.
const _typo = EnvVar.fromConfigMap({
  name: "DB_PORT",
  ref: cfg.ref,
  // @ts-expect-error - "PROT" is not in "HOST" | "PORT" | "LOG_LEVEL".
  key: "PROT"
})

// 6 · `EnvVar.fromConfigMap` rejects a key from a sibling map.
const flags = ConfigMap.make({
  name: "feature-flags",
  namespace: "prod",
  data: { NEW_UI: "true", BETA: "false" }
})
const _cross = EnvVar.fromConfigMap({
  name: "MISWIRED",
  ref: flags.ref,
  // @ts-expect-error - "HOST" is not in "NEW_UI" | "BETA".
  key: "HOST"
})

// 7 · Unkeyed (default K=string) ref accepts any string.
const opaque: ConfigMapRef<"opaque"> = "opaque" as ConfigMapRef<"opaque">
const _anyKey = EnvVar.fromConfigMap({ name: "OPAQUE", ref: opaque, key: "anything" })

void _ok
void _typo
void _cross
void _anyKey

export type _Tests = readonly [_DefaultK, _DefaultN, _TypedK, _CfgK, _CfgN]
