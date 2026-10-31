import { describe, expect, it } from "vitest"
import type {
  RunKubesealInput,
  SealedSecret,
  SealedSecretsBackendOptions,
  SealedSecretScope,
  SealedSecretSpec,
  SealedSecretTemplate
} from "./index"
import * as S from "./index"

const _scope: SealedSecretScope = "namespace-wide"

const _template: SealedSecretTemplate = { metadata: { name: "db" }, type: "Opaque" }

const _spec: SealedSecretSpec = { template: _template, encryptedData: { url: "AgB" } }

const _secret: SealedSecret = {
  apiVersion: "bitnami.com/v1alpha1",
  kind: "SealedSecret",
  metadata: { name: "db", namespace: "prod" },
  spec: _spec
}

const _options: SealedSecretsBackendOptions = { scope: _scope, certPath: "/c.pem", type: "Opaque" }

const _run: RunKubesealInput = { plainSecretYaml: "kind: Secret\n", certPath: "/c.pem", scope: "strict" }

describe("sealed-secrets barrel", () => {
  it("exposes the 0.4.0 runtime exports", () => {
    expect(Object.keys(S).sort()).toEqual([
      "KubesealCertMissing",
      "KubesealInvocationError",
      "KubesealParseError",
      "SealedSecrets",
      "resolveCertPath",
      "runKubeseal"
    ])
  })

  it("the public types describe the CR and option shapes", () => {
    expect([_secret.kind, _options.scope, _run.scope]).toEqual(["SealedSecret", "namespace-wide", "strict"])
  })
})
