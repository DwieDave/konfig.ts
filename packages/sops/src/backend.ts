import { Backend } from "@konfig.ts/k8s"
import { compileRegex } from "./encryption-policy"
import { passthroughManifest } from "./passthrough"
import { SopsEncryptedSecretSchema, type SopsRecipients } from "./schema"
import { sopsArgs } from "./sops"
import { _assertEncrypted } from "./verify"

interface SopsBackendOptions extends Backend.CliOptions {
  readonly recipients: SopsRecipients
  readonly encryptedRegex?: string
}

const _backend = Backend.encrypting({
  tag: "Sops",
  precheck: ({ label, opts }: { readonly opts: SopsBackendOptions; readonly label: string }) =>
    compileRegex({ field: "encrypted_regex", raw: opts.encryptedRegex ?? "", label }),
  toPlain: ({ base, opts, stringData }) => ({
    apiVersion: "isindir.github.com/v1alpha3",
    kind: "SopsSecret",
    metadata: Backend.secretMeta(base),
    spec: { secretTemplates: [{ name: base.name, type: opts.type ?? "Opaque", stringData }] }
  }),
  bin: "sops",
  args: ({ opts }) => sopsArgs({ recipients: opts.recipients, encryptedRegex: opts.encryptedRegex }),
  schema: SopsEncryptedSecretSchema,
  schemaLabel: "SopsSecret",
  verify: ({ decoded, label }) => _assertEncrypted({ secret: decoded, label })
})

const _passthrough = Backend.define({
  tag: "Sops.passthrough",
  requiresSource: false,
  emit: ({ base, label, opts }: Backend.EmitInput<string, string, { readonly file: string }, false>) =>
    passthroughManifest({ base, label, file: opts.file })
})

export const Sops = { backend: _backend, passthrough: _passthrough }
