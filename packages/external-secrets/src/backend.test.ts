import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Yaml } from "@konfig.ts/core"
import { Secret } from "@konfig.ts/k8s"
import { Effect } from "effect"
import { describe, expect, it as vitestIt } from "vitest"
import { ExternalSecrets } from "./backend"
import type { ExternalSecret } from "./crd"

const coerce = <T>(value: unknown): T => value as T

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
      const rendered = coerce<ExternalSecret>(yield* bound.manifest!.render(ctx))
      expect(rendered.apiVersion).toBe("external-secrets.io/v1beta1")
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
      const rendered = coerce<ExternalSecret>(yield* bound.manifest!.render(ctx))
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
      const rendered = yield* bound.manifest!.render(ctx)
      const yaml = Yaml.serialize({ value: rendered })
      expect(yaml).toContain("apiVersion: external-secrets.io/v1beta1")
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
      const rendered = coerce<ExternalSecret>(yield* bound.manifest!.render(ctx))
      expect(rendered.spec.data?.[0]?.remoteRef).toEqual({
        key: "kv/data/api",
        property: "url",
        version: "2",
        conversionStrategy: "Default"
      })
    }).pipe(Effect.provide(NodeServices.layer)))
})
