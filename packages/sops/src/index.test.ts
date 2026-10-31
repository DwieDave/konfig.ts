import { describe, expect, it } from "vitest"
import type {
  SopsBackendOptions,
  SopsDecryptInput,
  SopsEncryptStdinInput,
  SopsRecipients,
  SopsSecret,
  SopsSecretSpec,
  SopsSecretTemplate,
  SopsSourceInput
} from "./index"
import * as S from "./index"

const AGE = "age1stub00000000000000000000000000000000000000000000000000ends"

const _template: SopsSecretTemplate = { name: "db", stringData: { url: "ENC[x]" } }

const _spec: SopsSecretSpec = { secretTemplates: [_template] }

const _recipients: SopsRecipients = { age: [AGE] }

const _secret: SopsSecret = {
  apiVersion: "isindir.github.com/v1alpha3",
  kind: "SopsSecret",
  metadata: { name: "db", namespace: "prod" },
  spec: _spec,
  sops: { mac_only_encrypted: true }
}

const _options: SopsBackendOptions = { recipients: _recipients, type: "Opaque", encryptedRegex: "^data$" }

const _source: SopsSourceInput<"url"> = { file: "db.enc.yaml", keys: ["url"], extract: (key) => key }

const _decrypt: SopsDecryptInput = { file: "db.enc.yaml" }

const _encrypt: SopsEncryptStdinInput = { plaintextYaml: "a: b\n", recipients: _recipients }

describe("sops barrel", () => {
  it("exposes the 0.4.0 runtime exports", () => {
    expect(Object.keys(S).sort()).toEqual(["Sops", "SopsInvocationError", "sopsDecrypt", "sopsEncryptStdin"])
  })

  it("Sops exposes backend, passthrough and source", () => {
    expect(Object.keys(S.Sops).sort()).toEqual(["backend", "passthrough", "source"])
  })

  it("the public types describe the CR and option shapes", () => {
    expect([_secret.kind, _options.type, _source.file, _decrypt.file, _encrypt.plaintextYaml]).toEqual([
      "SopsSecret",
      "Opaque",
      "db.enc.yaml",
      "db.enc.yaml",
      "a: b\n"
    ])
  })
})
