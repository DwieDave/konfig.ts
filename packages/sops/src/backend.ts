import { Manifest } from "@konfig.ts/core"
import {
  type BackendEmitInput,
  backendLabel,
  type EmitInput,
  encryptVia,
  SecretBackend,
  secretMeta
} from "@konfig.ts/k8s"
import type { Duration } from "effect"
import type { SopsRecipients, SopsSecret } from "./crd"
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

const _emit = <N extends string, K extends string>(
  input: EmitInput<N, K, SopsBackendOptions>
): Manifest.Manifest<SopsSecret> =>
  Manifest.make<SopsSecret>((_ctx) => {
    const label = backendLabel({ tag: "Sops", base: input.base })

    return encryptVia({
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
  })

export const Sops = {
  backend: <N extends string, K extends string>(
    opts: SopsBackendOptions
  ): SecretBackend<N, K, true, SopsSecret> =>
    SecretBackend.make({
      tag: "Sops",
      requiresSource: true,
      emit: (base: BackendEmitInput<N, K, true>) => _emit({ base, opts })
    }),
  passthrough: <N extends string, K extends string>(opts: {
    readonly file: string
  }): SecretBackend<N, K, false, SopsSecret> =>
    SecretBackend.make({
      tag: "Sops.passthrough",
      requiresSource: false,
      emit: (base: BackendEmitInput<N, K, false>) => passthroughManifest({ base, file: opts.file })
    })
}
