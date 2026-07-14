import { Downward, Literal, SecretSource } from "@konfig.ts/env"
import { describe, expect, it } from "vitest"
import { Environment, Secret } from "./index"

const dbCreds = Secret.define({
  name: "db-creds",
  namespace: "prod",
  env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" }
})

const sessionKey = Secret.define({
  name: "session-key",
  namespace: "prod",
  env: { value: "SESSION_KEY" }
})

const port = Literal.define({ envName: "PORT", value: 8080 })
const podName = Downward.define({ envName: "POD_NAME", fieldPath: "metadata.name" })

// Reusable source-only opts — every secret member must supply a backend
// or a source, so tests that only care about envVars / namespace use a
// throwaway literal source.
const dbCredsOpts = {
  source: SecretSource.literal({ data: { url: "u", password: "p" } })
} as const
const sessionKeyOpts = {
  source: SecretSource.literal({ data: { value: "s" } })
} as const

describe("Secret.bind", () => {
  it("produces a typed ref and envVars per key", () => {
    const bound = Secret.bind({ secret: dbCreds })
    expect(bound.ref).toBe("db-creds")
    expect(bound.name).toBe("db-creds")
    expect(bound.namespace).toBe("prod")
    expect(bound.envVars).toHaveLength(2)

    const byName = new Map(bound.envVars.map((e) => [e.name, e]))
    expect(byName.get("DATABASE_URL")?.valueFrom?.secretKeyRef).toEqual({
      name: "db-creds",
      key: "url"
    })
    expect(byName.get("DATABASE_PASSWORD")?.valueFrom?.secretKeyRef).toEqual({
      name: "db-creds",
      key: "password"
    })
  })
})

describe("Environment.bind", () => {
  const apiEnv = Environment.define({
    db: dbCreds,
    session: sessionKey,
    port,
    pod: podName
  })
  const apiSecrets = { db: dbCredsOpts, session: sessionKeyOpts } as const

  it("walks every member and concatenates envVars", () => {
    const bound = Environment.bind({ env: apiEnv, secrets: apiSecrets })
    const names = bound.envVars.map((e) => e.name).sort()
    expect(names).toEqual(["DATABASE_PASSWORD", "DATABASE_URL", "POD_NAME", "PORT", "SESSION_KEY"])
  })

  it("literal members produce { name, value }", () => {
    const bound = Environment.bind({ env: apiEnv, secrets: apiSecrets })
    const portEntry = bound.envVars.find((e) => e.name === "PORT")
    expect(portEntry?.value).toBe("8080")
    expect(portEntry?.valueFrom).toBeUndefined()
  })

  it("downward members produce a fieldRef envVar", () => {
    const bound = Environment.bind({ env: apiEnv, secrets: apiSecrets })
    const pod = bound.envVars.find((e) => e.name === "POD_NAME")
    expect(pod?.valueFrom?.fieldRef?.fieldPath).toBe("metadata.name")
  })

  it("exposes declared per-member handles via .members", () => {
    const bound = Environment.bind({ env: apiEnv, secrets: apiSecrets })
    expect(bound.members.db.ref).toBe("db-creds")
    expect(bound.members.session.ref).toBe("session-key")
    expect(bound.members.port.value).toBe(8080)
    expect(bound.members.pod.fieldPath).toBe("metadata.name")
  })

  it("works with a single-member bundle", () => {
    const env = Environment.define({ db: dbCreds })
    const bound = Environment.bind({ env, secrets: { db: dbCredsOpts } })
    expect(bound.envVars).toHaveLength(2)
    expect(bound.members.db.ref).toBe("db-creds")
  })

  it("namespace override at bind time wins over the contract's declared namespace", () => {
    const bound = Environment.bind({
      env: apiEnv,
      secrets: apiSecrets,
      namespace: "staging"
    })
    expect(bound.members.db.namespace).toBe("staging")
    expect(bound.members.session.namespace).toBe("staging")
    // envVars are namespace-independent — they only carry the Secret name + key.
    expect(bound.envVars.map((e) => e.name).sort()).toEqual([
      "DATABASE_PASSWORD",
      "DATABASE_URL",
      "POD_NAME",
      "PORT",
      "SESSION_KEY"
    ])
  })
})

describe("Secret.bind namespace override", () => {
  it("overrides the contract namespace for the manifest binding", () => {
    const bound = Secret.bind({ secret: dbCreds, namespace: "staging" })
    expect(bound.namespace).toBe("staging")
    // envVars carry the secret name + key only — namespace is invisible.
    expect(bound.envVars).toHaveLength(2)
  })

  it("falls back to the contract namespace when no override is given", () => {
    const bound = Secret.bind({ secret: dbCreds })
    expect(bound.namespace).toBe("prod")
  })
})

describe("Environment.bind nested groups", () => {
  const dbHost = Literal.define({ envName: "DB_HOST", value: "" })
  const dbPort = Literal.define({ envName: "DB_PORT", value: 0 })
  const apiPort = Literal.define({ envName: "API_PORT", value: 8080 })

  const apiEnv = Environment.define({
    db: Environment.define({
      creds: dbCreds,
      host: dbHost,
      port: dbPort
    }),
    api: apiPort
  })
  const apiSecrets = { db: { creds: dbCredsOpts } } as const

  it("recurses into nested Environment members and flattens envVars", () => {
    const bound = Environment.bind({ env: apiEnv, secrets: apiSecrets })
    const names = bound.envVars.map((e) => e.name).sort()
    expect(names).toEqual([
      "API_PORT",
      "DATABASE_PASSWORD",
      "DATABASE_URL",
      "DB_HOST",
      "DB_PORT"
    ])
  })

  it("exposes nested declared members as a sub-record", () => {
    const bound = Environment.bind({ env: apiEnv, secrets: apiSecrets })
    expect(bound.members.db.creds.ref).toBe("db-creds")
    expect(bound.members.db.host.value).toBe("")
    expect(bound.members.db.port.value).toBe(0)
    expect(bound.members.api.value).toBe(8080)
  })

  it("nested literal overrides apply to the nested envVar", () => {
    const bound = Environment.bind({
      env: apiEnv,
      secrets: apiSecrets,
      literals: {
        db: { host: "db.prod.svc", port: 5432 }
      }
    })
    const byName = new Map(bound.envVars.map((e) => [e.name, e]))
    expect(byName.get("DB_HOST")?.value).toBe("db.prod.svc")
    expect(byName.get("DB_PORT")?.value).toBe("5432")
  })

  it("top-level namespace override applies to nested secrets", () => {
    const bound = Environment.bind({
      env: apiEnv,
      secrets: apiSecrets,
      namespace: "staging"
    })
    expect(bound.members.db.creds.namespace).toBe("staging")
  })
})

describe("Environment.bind literal value overrides", () => {
  const clientUrl = Literal.define({ envName: "CLIENT_URL", value: "" })
  const replicas = Literal.define({ envName: "REPLICAS", value: 0 })
  const env = Environment.define({ db: dbCreds, clientUrl, replicas })
  const envSecrets = { db: dbCredsOpts } as const

  it("a missing override falls back to the declared value", () => {
    const bound = Environment.bind({ env, secrets: envSecrets })
    const byName = new Map(bound.envVars.map((e) => [e.name, e]))
    expect(byName.get("CLIENT_URL")?.value).toBe("")
    expect(byName.get("REPLICAS")?.value).toBe("0")
  })

  it("a provided override replaces the manifest's emitted env var", () => {
    const bound = Environment.bind({
      env,
      secrets: envSecrets,
      literals: { clientUrl: "https://api.example.com", replicas: 3 }
    })
    const byName = new Map(bound.envVars.map((e) => [e.name, e]))
    expect(byName.get("CLIENT_URL")?.value).toBe("https://api.example.com")
    expect(byName.get("REPLICAS")?.value).toBe("3")
  })

  it("the override updates the declared member's value field too", () => {
    const bound = Environment.bind({
      env,
      secrets: envSecrets,
      literals: { replicas: 3 }
    })
    expect(bound.members.replicas.value).toBe(3)
    expect(bound.members.clientUrl.value).toBe("")
  })

  it("partial overrides only touch the named members", () => {
    const bound = Environment.bind({
      env,
      secrets: envSecrets,
      literals: { clientUrl: "https://x" }
    })
    const byName = new Map(bound.envVars.map((e) => [e.name, e]))
    expect(byName.get("CLIENT_URL")?.value).toBe("https://x")
    expect(byName.get("REPLICAS")?.value).toBe("0")
  })

  it("a literal-only bundle binds without a secrets field", () => {
    const litOnly = Environment.define({ clientUrl, replicas })
    const bound = Environment.bind({ env: litOnly })
    const byName = new Map(bound.envVars.map((e) => [e.name, e]))
    expect(byName.get("CLIENT_URL")?.value).toBe("")
    expect(byName.get("REPLICAS")?.value).toBe("0")
  })

  it("custom serialize fn is reused for overrides", () => {
    const lit = Literal.define({
      envName: "LIST",
      value: ["a"] as ReadonlyArray<string>,
      serialize: (xs: ReadonlyArray<string>) => xs.join(",")
    })
    const e = Environment.define({ lit })
    const bound = Environment.bind({ env: e, literals: { lit: ["a", "b", "c"] } })
    const entry = bound.envVars.find((v) => v.name === "LIST")
    expect(entry?.value).toBe("a,b,c")
  })
})
