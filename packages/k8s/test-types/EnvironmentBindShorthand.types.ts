import { SecretSource } from "@konfig.ts/env"
import { Literal } from "@konfig.ts/env"
import type { SecretBackend, SecretRef } from "@konfig.ts/k8s"
import { Environment, NativeSecret, Secret } from "@konfig.ts/k8s"

type Expect<T extends true> = T
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

const dbCreds = Secret.define({
  name: "db-creds",
  namespace: "prod",
  env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" }
})
const sessionKey = Secret.define({ name: "session-key", namespace: "prod", env: { value: "SESSION_KEY" } })
const port = Literal.define({ envName: "PORT", value: 8080 })
const apiEnv = Environment.define({ db: dbCreds, session: sessionKey, port })

declare const sopsLike: SecretBackend<"db-creds", "url" | "password", false>
const session = SecretSource.literal({ data: { value: "s" } })

// Bare source / bare no-source backend accepted; member inference intact.
const bare = Environment.bind({
  env: apiEnv,
  namespace: "prod",
  secrets: {
    db: sopsLike,
    session
  }
})
type _BareRef = Expect<Equal<typeof bare.members.db.ref, SecretRef<"db-creds", "url" | "password", "prod">>>
type _BareName = Expect<Equal<typeof bare.members.db.name, "db-creds">>
type _BareNs = Expect<Equal<typeof bare.members.db.namespace, "prod">>
type _BarePort = Expect<Equal<typeof bare.members.port.value, number>>

// Object form still accepted, mixed with shorthand.
const mixed = Environment.bind({
  env: apiEnv,
  secrets: {
    db: { backend: NativeSecret.backend(), source: SecretSource.literal({ data: { url: "u", password: "p" } }) },
    session
  }
})
void mixed

// A backend that requires a source is rejected in bare form.
Environment.bind({
  env: apiEnv,
  secrets: {
    // @ts-expect-error — SecretBackend<N, K, true> must be paired with a source via the object form
    db: NativeSecret.backend(),
    session
  }
})

// A source with the wrong keys is rejected.
Environment.bind({
  env: apiEnv,
  secrets: {
    // @ts-expect-error — { wrong } does not satisfy url | password
    db: SecretSource.literal({ data: { wrong: "x" } }),
    session
  }
})

// A backend for a different secret name is rejected.
declare const otherName: SecretBackend<"other", "url" | "password", false>
Environment.bind({
  env: apiEnv,
  secrets: {
    // @ts-expect-error — backend is typed for "other", not "db-creds"
    db: otherName,
    session
  }
})

// Omitting a declared secret is rejected.
Environment.bind({
  env: apiEnv,
  // @ts-expect-error — session is missing
  secrets: { db: sopsLike }
})

// Nested groups: shorthand works inside a sub-record; a sub-record is never mistaken for a bare value.
const nested = Environment.define({ inner: Environment.define({ db: dbCreds }), session: sessionKey })
const nestedBound = Environment.bind({
  env: nested,
  secrets: { inner: { db: sopsLike }, session }
})
type _NestedRef = Expect<Equal<typeof nestedBound.members.inner.db.name, "db-creds">>

export type _Tests = readonly [_BareRef, _BareName, _BareNs, _BarePort, _NestedRef]
