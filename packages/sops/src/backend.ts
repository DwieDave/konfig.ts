import { type BoundaryDecodeError, Manifest, RenderError, Yaml } from "@konfig.ts/core"
import { Backend } from "@konfig.ts/k8s"
import { Effect, Redacted } from "effect"
import { compileRegex } from "./encryption-policy"
import { passthroughManifest } from "./passthrough"
import type { SopsRecipients, SopsSecret } from "./schema"
import { sopsEncryptStdin, type SopsInvocationError } from "./sops"
import { SopsSource } from "./source"
import { parseVerified } from "./verify"

export interface SopsBackendOptions extends Backend.CliOptions {
  readonly recipients: SopsRecipients
  readonly encryptedRegex?: string
}

type _EmitInput<N extends string, K extends string> = Backend.EmitInput<N, K, SopsBackendOptions>

const _FAILURES = {
  BoundaryDecodeError: "sops recipients did not match SopsRecipients",
  SopsInvocationError: "sops failed"
}

const _renderError = (label: string) => (cause: BoundaryDecodeError | SopsInvocationError): RenderError =>
  new RenderError({ message: `${label}: ${_FAILURES[cause._tag]}`, cause })

const _plaintext = <N extends string, K extends string>({ base, label }: Omit<_EmitInput<N, K>, "opts">) =>
  base.source.resolve.pipe(
    Effect.mapError((cause) => new RenderError({ message: `${label}: source failed for key "${cause.key}"`, cause })),
    Effect.map((resolved) => Object.fromEntries(base.keys.map((key) => [key, Redacted.value(resolved[key])])))
  )

const _toPlain = <N extends string, K extends string>(
  { base, opts, stringData }: Omit<_EmitInput<N, K>, "label"> & { readonly stringData: Record<string, string> }
) => ({
  apiVersion: "isindir.github.com/v1alpha3",
  kind: "SopsSecret",
  metadata: Backend.secretMeta(base),
  spec: { secretTemplates: [{ name: base.name, type: opts.type ?? "Opaque", stringData }] }
})

const _emit = <N extends string, K extends string>(input: _EmitInput<N, K>): Manifest.Manifest<SopsSecret> =>
  Manifest.make<SopsSecret>(() =>
    Effect.gen(function*() {
      const { label, opts } = input
      yield* compileRegex({ field: "encrypted_regex", raw: opts.encryptedRegex ?? "", label })
      const stringData = yield* _plaintext(input)

      const yamlText = yield* sopsEncryptStdin({
        plaintextYaml: Yaml.serialize({ value: _toPlain({ ...input, stringData }) }),
        recipients: opts.recipients,
        encryptedRegex: opts.encryptedRegex,
        timeout: opts.timeout
      }).pipe(Effect.mapError(_renderError(label)))

      return yield* parseVerified({ yamlText, label, subject: "sops output", what: "sops failed" })
    })
  )

const _passthrough = Backend.define({
  tag: "Sops.passthrough",
  requiresSource: false,
  emit: ({ base, label, opts }: Backend.EmitInput<string, string, { readonly file: string }, false>) =>
    passthroughManifest({ base, label, file: opts.file })
})

export const Sops = {
  backend: Backend.define({ tag: "Sops", requiresSource: true, emit: _emit }),
  passthrough: _passthrough,
  source: SopsSource.source
}
