import { describe, expect, it } from "vitest"
import type {
  ExternalSecret,
  ExternalSecretCreationPolicy,
  ExternalSecretDataEntry,
  ExternalSecretDeletionPolicy,
  ExternalSecretRemoteRef,
  ExternalSecretsBackendOptions,
  ExternalSecretSpec,
  ExternalSecretTarget,
  SecretStoreKind,
  SecretStoreRef
} from "./index"
import * as E from "./index"

const _kind: SecretStoreKind = "ClusterSecretStore"

const _store: SecretStoreRef = { name: "aws", kind: _kind }

const _remote: ExternalSecretRemoteRef = { key: "prod/db", property: "url", decodingStrategy: "None" }

const _entry: ExternalSecretDataEntry = { secretKey: "url", remoteRef: _remote }

const _creation: ExternalSecretCreationPolicy = "Orphan"

const _deletion: ExternalSecretDeletionPolicy = "Retain"

const _target: ExternalSecretTarget = { creationPolicy: _creation, deletionPolicy: _deletion, immutable: true }

const _spec: ExternalSecretSpec = { refreshInterval: "1h", secretStoreRef: _store, target: _target, data: [_entry] }

const _secret: ExternalSecret = {
  apiVersion: "external-secrets.io/v1",
  kind: "ExternalSecret",
  metadata: { name: "db" },
  spec: _spec
}

const _options: ExternalSecretsBackendOptions<"url"> = {
  secretStoreRef: _store,
  refreshInterval: "1h30m",
  remoteRef: (key) => ({ key: `prod/${key}` }),
  target: { creationPolicy: "Owner" }
}

describe("external-secrets barrel", () => {
  it("exposes the 0.4.0 runtime exports", () => {
    expect(Object.keys(E)).toEqual(["ExternalSecrets"])
  })

  it("the public types describe the CR and option shapes", () => {
    expect([_secret.kind, _options.refreshInterval, _options.remoteRef?.("url").key]).toEqual([
      "ExternalSecret",
      "1h30m",
      "prod/url"
    ])
  })
})
