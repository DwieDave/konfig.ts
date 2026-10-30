import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Yaml } from "@konfig.ts/core"
import { Secret } from "@konfig.ts/k8s"
import { Cause, Effect, Exit, Schema } from "effect"
import { describe, expect, it as vitestIt } from "vitest"
import { ExternalSecrets } from "./backend"
import { type GoDuration, InvalidRefreshIntervalError } from "./duration"

const _optionalString = Schema.optional(Schema.String)

const _ExternalSecretSchema = Schema.Struct({
  apiVersion: Schema.String,
  kind: Schema.String,
  metadata: Schema.Struct({ name: Schema.String, namespace: Schema.String }),
  spec: Schema.Struct({
    refreshInterval: _optionalString,
    secretStoreRef: Schema.Struct({ name: Schema.String, kind: _optionalString }),
    data: Schema.optional(
      Schema.Array(
        Schema.Struct({
          secretKey: Schema.String,
          remoteRef: Schema.Struct({
            key: Schema.String,
            property: _optionalString,
            version: _optionalString,
            conversionStrategy: _optionalString,
            decodingStrategy: _optionalString
          })
        })
      )
    )
  })
})

const _asExternalSecret = Schema.decodeUnknownEffect(_ExternalSecretSchema)

const dbCreds = Secret.define({
  name: "db-creds",
  namespace: "prod",
  env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" }
})

const ctx = { env: "prod" } as const

describe("ExternalSecrets.backend", () => {
  it.effect("renders an ExternalSecret CR matching the scratchpad spec", () =>
    Effect.gen(function*() {
      const bound = Secret.bind({
        secret: dbCreds,
        backend: ExternalSecrets.backend({
          secretStoreRef: { name: "aws-prod", kind: "ClusterSecretStore" },
          refreshInterval: "1h",
          remoteRef: (key) => ({ key: `prod/api/${key}` })
        })
      })

      const rendered = yield* _asExternalSecret(yield* bound.manifest!.render(ctx))
      expect(rendered.apiVersion).toBe("external-secrets.io/v1")
      expect(rendered.kind).toBe("ExternalSecret")
      expect(rendered.metadata.name).toBe("db-creds")
      expect(rendered.metadata.namespace).toBe("prod")
      expect(rendered.spec.refreshInterval).toBe("1h")
      expect(rendered.spec.secretStoreRef).toEqual({
        name: "aws-prod",
        kind: "ClusterSecretStore"
      })
      expect(rendered.spec.data).toEqual([
        { secretKey: "url", remoteRef: { key: "prod/api/url" } },
        { secretKey: "password", remoteRef: { key: "prod/api/password" } }
      ])
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("defaults: kind=SecretStore, remoteRef=identity, no refreshInterval", () =>
    Effect.gen(function*() {
      const bound = Secret.bind({
        secret: dbCreds,
        backend: ExternalSecrets.backend({ secretStoreRef: { name: "vault" } })
      })

      const rendered = yield* _asExternalSecret(yield* bound.manifest!.render(ctx))
      expect(rendered.spec.secretStoreRef.kind).toBe("SecretStore")
      expect(rendered.spec.refreshInterval).toBeUndefined()
      expect(rendered.spec.data).toEqual([
        { secretKey: "url", remoteRef: { key: "url" } },
        { secretKey: "password", remoteRef: { key: "password" } }
      ])
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("YAML output reads like the documented spec", () =>
    Effect.gen(function*() {
      const bound = Secret.bind({
        secret: dbCreds,
        backend: ExternalSecrets.backend({
          secretStoreRef: { name: "aws-prod", kind: "ClusterSecretStore" },
          refreshInterval: "1h",
          remoteRef: (key) => ({ key: `prod/api/${key}` })
        })
      })

      const rendered = yield* _asExternalSecret(yield* bound.manifest!.render(ctx))
      const yaml = Yaml.serialize({ value: rendered })
      expect(yaml).toContain("apiVersion: external-secrets.io/v1")
      expect(yaml).toContain("kind: ExternalSecret")
      expect(yaml).toContain("name: aws-prod")
      expect(yaml).toContain("kind: ClusterSecretStore")
      expect(yaml).toContain("refreshInterval: 1h")
      expect(yaml).toContain("secretKey: url")
      expect(yaml).toContain("key: prod/api/url")
    }).pipe(Effect.provide(NodeServices.layer)))

  vitestIt("requiresSource is false", () => {
    const b = ExternalSecrets.backend<"db-creds", "url" | "password">({
      secretStoreRef: { name: "x" }
    })

    expect(b.requiresSource).toBe(false)
  })

  vitestIt("Secret.bind without source still works (backend doesn't need it)", () => {
    const bound = Secret.bind({
      secret: dbCreds,
      backend: ExternalSecrets.backend({ secretStoreRef: { name: "x" } })
    })

    expect(bound.manifest).toBeDefined()
    expect(bound.envVars).toHaveLength(2)
    expect(bound.ref).toBe("db-creds")
  })

  it.effect("remoteRef can include property, version, conversion/decoding strategy", () =>
    Effect.gen(function*() {
      const bound = Secret.bind({
        secret: dbCreds,
        backend: ExternalSecrets.backend({
          secretStoreRef: { name: "vault" },
          remoteRef: (key) => ({
            key: `kv/data/api`,
            property: key,
            version: "2",
            conversionStrategy: "Default"
          })
        })
      })

      const rendered = yield* _asExternalSecret(yield* bound.manifest!.render(ctx))
      expect(rendered.spec.data?.[0]?.remoteRef).toEqual({
        key: "kv/data/api",
        property: "url",
        version: "2",
        conversionStrategy: "Default"
      })
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("ExternalSecrets.backend refreshInterval", () => {
  const render = (refreshInterval: GoDuration | undefined) =>
    Secret.bind({
      secret: dbCreds,
      backend: ExternalSecrets.backend({
        secretStoreRef: { name: "s" },
        refreshInterval: refreshInterval
      })
    }).manifest!.render(ctx)

  it.effect("accepts Go durations such as 1h30m", () =>
    Effect.gen(function*() {
      const rendered = yield* _asExternalSecret(yield* render("1h30m"))
      expect(rendered.spec.refreshInterval).toBe("1h30m")
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("dies on an invalid refreshInterval", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(render("1sjunk"))
      const defect = Exit.isFailure(exit) ? exit.cause.reasons.find(Cause.isDieReason)?.defect : undefined
      expect(defect).toBeInstanceOf(InvalidRefreshIntervalError)
      expect(defect).toMatchObject({ value: "1sjunk" })
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("renders without refreshInterval", () =>
    Effect.gen(function*() {
      const rendered = yield* _asExternalSecret(yield* render(undefined))
      expect(rendered.spec.refreshInterval).toBeUndefined()
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("accepts 0 and 500ms", () =>
    Effect.gen(function*() {
      const zero = yield* _asExternalSecret(yield* render("0"))
      const ms = yield* _asExternalSecret(yield* render("500ms"))
      expect([zero.spec.refreshInterval, ms.spec.refreshInterval]).toEqual(["0", "500ms"])
    }).pipe(Effect.provide(NodeServices.layer)))
})
