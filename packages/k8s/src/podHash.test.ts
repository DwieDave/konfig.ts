import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { SecretSource } from "@konfig.ts/env"
import { Effect, Redacted } from "effect"
import { describe, expect, it as vitestIt } from "vitest"
import { Environment, hashSecretValues, Secret } from "./index"

const dbCreds = Secret.define({
  name: "db-creds",
  namespace: "prod",
  env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" }
})

describe("hashSecretValues", () => {
  vitestIt("deterministic over the same input", () => {
    const a = hashSecretValues({
      salt: "prod/api",
      values: { url: Redacted.make("u"), password: Redacted.make("p") }
    })
    const b = hashSecretValues({
      salt: "prod/api",
      values: { url: Redacted.make("u"), password: Redacted.make("p") }
    })
    expect(a).toBe(b)
  })

  vitestIt("sorted-by-key — insertion order doesn't matter", () => {
    const a = hashSecretValues({
      salt: "prod/api",
      values: { url: Redacted.make("u"), password: Redacted.make("p") }
    })
    const b = hashSecretValues({
      salt: "prod/api",
      values: { password: Redacted.make("p"), url: Redacted.make("u") }
    })
    expect(a).toBe(b)
  })

  vitestIt("changing any value changes the hash", () => {
    const a = hashSecretValues({ salt: "s", values: { x: Redacted.make("1") } })
    const b = hashSecretValues({ salt: "s", values: { x: Redacted.make("2") } })
    expect(a).not.toBe(b)
  })

  vitestIt("output is the full-width sha256 hex digest (64 chars)", () => {
    const h = hashSecretValues({ salt: "s", values: { x: Redacted.make("v") } })
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  vitestIt("salt is mixed in — same values under a different salt differ", () => {
    const a = hashSecretValues({ salt: "prod/api", values: { x: Redacted.make("v") } })
    const b = hashSecretValues({ salt: "staging/api", values: { x: Redacted.make("v") } })
    expect(a).not.toBe(b)
  })

  vitestIt("delimiter framing — a key/value boundary cannot be forged", () => {
    // With naive `key + "=" + value + "\n"` concatenation these two records
    // would hash identically; netstring framing keeps them distinct.
    const a = hashSecretValues({ salt: "s", values: { "a=b": Redacted.make("c") } })
    const b = hashSecretValues({ salt: "s", values: { a: Redacted.make("b=c") } })
    expect(a).not.toBe(b)

    const c = hashSecretValues({ salt: "s", values: { "a\nb": Redacted.make("c") } })
    const d = hashSecretValues({ salt: "s", values: { a: Redacted.make("b\nc") } })
    expect(c).not.toBe(d)
  })
})

describe("Secret.bind values service", () => {
  vitestIt("source supplied → .values and .layer defined", () => {
    const b = Secret.bind({
      secret: dbCreds,
      source: SecretSource.literal({ data: { url: "u", password: "p" } })
    })
    expect(b.values).toBeDefined()
    expect(b.layer).toBeDefined()
  })

  vitestIt("no source → .values and .layer undefined", () => {
    const b = Secret.bind({ secret: dbCreds })
    expect(b.values).toBeUndefined()
    expect(b.layer).toBeUndefined()
  })

  it.effect("yielding .values inside an Effect resolves to typed Redacted record", () =>
    Effect.gen(function*() {
      const b = Secret.bind({
        secret: dbCreds,
        source: SecretSource.literal({
          data: { url: "postgres://x", password: "hunter2" }
        })
      })
      const v = yield* b.values!
      expect(Redacted.value(v.url)).toBe("postgres://x")
      expect(Redacted.value(v.password)).toBe("hunter2")
      const hash = hashSecretValues({ salt: "prod/db-creds", values: v })
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    }).pipe(
      Effect.provide(
        Secret.bind({
          secret: dbCreds,
          source: SecretSource.literal({
            data: { url: "postgres://x", password: "hunter2" }
          })
        }).layer!
      ),
      Effect.provide(NodeServices.layer)
    ))
})

describe("Environment.bind valuesLayer", () => {
  const sessionKey = Secret.define({
    name: "session-key",
    namespace: "prod",
    env: { value: "SESSION_KEY" }
  })

  const apiEnv = Environment.define({ db: dbCreds, session: sessionKey })

  it.effect("aggregates per-member values layers; yields both via tags", () =>
    Effect.gen(function*() {
      const bound = Environment.bind({
        env: apiEnv,
        secrets: {
          db: {
            source: SecretSource.literal({ data: { url: "u", password: "p" } })
          },
          session: {
            source: SecretSource.literal({ data: { value: "sig" } })
          }
        }
      })
      const dbV = yield* bound.members.db.values!
      const sV = yield* bound.members.session.values!
      expect(Redacted.value(dbV.url)).toBe("u")
      expect(Redacted.value(sV.value)).toBe("sig")
    }).pipe(
      Effect.provide(
        Environment.bind({
          env: apiEnv,
          secrets: {
            db: {
              source: SecretSource.literal({ data: { url: "u", password: "p" } })
            },
            session: {
              source: SecretSource.literal({ data: { value: "sig" } })
            }
          }
        }).valuesLayer
      ),
      Effect.provide(NodeServices.layer)
    ))
})
