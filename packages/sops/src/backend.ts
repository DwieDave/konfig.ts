import { Manifest } from "@konfig.ts/core"
import { type EmitInput, encryptVia, SecretBackend, secretMeta } from "@konfig.ts/k8s"
import { type Duration, Effect } from "effect"
import type { SopsRecipients, SopsSecret } from "./crd"
import { compileRegex } from "./encryption-policy"
import { passthroughManifest } from "./passthrough"
import { sopsEncrypt } from "./sops"
import { parseVerified } from "./verify"

export interface SopsBackendOptions {
  readonly recipients: SopsRecipients
  readonly type?: string
  readonly encryptedRegex?: string
  readonly timeout?: Duration.Input
}

const _plainCR = <N extends string, K extends string>(
  input: EmitInput<N, K, SopsBackendOptions> & { readonly stringData: Record<string, string> }
) => ({
  apiVersion: "isindir.github.com/v1alpha3" as const,
  kind: "SopsSecret" as const,
  metadata: secretMeta(input.base),
  spec: {
    secretTemplates: [{ name: input.base.name, type: input.opts.type ?? "Opaque", stringData: input.stringData }]
  }
})

const _checkRegex = (input: { readonly raw: string | undefined; readonly label: string }) =>
  compileRegex({ field: "encrypted_regex", raw: input.raw ?? "", label: input.label })

const _emit = <N extends string, K extends string>(
  input: EmitInput<N, K, SopsBackendOptions> & { readonly label: string }
): Manifest.Manifest<SopsSecret> =>
  Manifest.make<SopsSecret>((_ctx) => {
    const { label } = input

    return _checkRegex({ raw: input.opts.encryptedRegex, label }).pipe(Effect.flatMap(() =>
      encryptVia({
        base: input.base,
        label,
        toPlain: (stringData) => _plainCR({ ...input, stringData }),
        encrypt: (plainYaml) =>
          sopsEncrypt({
            plainYaml,
            recipients: input.opts.recipients,
            encryptedRegex: input.opts.encryptedRegex,
            timeout: input.opts.timeout,
            label
          }),
        verify: (yamlText) => parseVerified({ yamlText, label })
      })
    ))
  })

export const Sops = {
  backend: <N extends string, K extends string>(
    opts: SopsBackendOptions
  ): SecretBackend<N, K, true, SopsSecret> =>
    SecretBackend.make({
      tag: "Sops",
      requiresSource: true,
      emit: ({ base, label }) => _emit({ base, label, opts })
    }),
  passthrough: <N extends string, K extends string>(opts: {
    readonly file: string
  }): SecretBackend<N, K, false, SopsSecret> =>
    SecretBackend.make({
      tag: "Sops.passthrough",
      requiresSource: false,
      emit: ({ base, label }) => passthroughManifest({ base, label, file: opts.file })
    })
}
