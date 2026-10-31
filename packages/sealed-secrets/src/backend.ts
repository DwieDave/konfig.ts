import { Manifest, RenderError, Yaml } from "@konfig.ts/core"
import { Backend } from "@konfig.ts/k8s"
import { Effect, Redacted } from "effect"
import { type KubesealCertMissing, type KubesealFailure, resolveCertPath, runKubeseal } from "./kubeseal"
import type { SealedSecret, SealedSecretScope } from "./schema"

export interface SealedSecretsBackendOptions extends Backend.CliOptions {
  readonly scope?: SealedSecretScope
  readonly certPath?: string
}

const _FAILURES = {
  KubesealCertMissing: "cert missing — pass opts.certPath or set $KUBESEAL_CERT",
  KubesealInvocationError: "kubeseal failed",
  KubesealParseError: "kubeseal failed — output was not valid YAML",
  BoundaryDecodeError: "kubeseal output did not match SealedSecret"
}

const _renderError = (label: string) => (cause: KubesealCertMissing | KubesealFailure): RenderError =>
  new RenderError({ message: `${label}: ${_FAILURES[cause._tag]}`, cause })

const _plaintext = <N extends string, K extends string>(
  { base, label }: { readonly base: Backend.BaseInput<N, K, true>; readonly label: string }
) =>
  base.source.resolve.pipe(
    Effect.mapError((cause) => new RenderError({ message: `${label}: source failed for key "${cause.key}"`, cause })),
    Effect.map((resolved) => Object.fromEntries(base.keys.map((key) => [key, Redacted.value(resolved[key])])))
  )

const _emit = <N extends string, K extends string>(
  { base, label, opts }: Backend.EmitInput<N, K, SealedSecretsBackendOptions>
): Manifest.Manifest<SealedSecret> =>
  Manifest.make<SealedSecret>(() =>
    Effect.gen(function*() {
      const certPath = yield* resolveCertPath({ certPath: opts.certPath }).pipe(Effect.mapError(_renderError(label)))
      const stringData = yield* _plaintext({ base, label })
      const secret = Backend.plainSecret({ base, type: opts.type ?? "Opaque", stringData })

      return yield* runKubeseal({
        plainSecretYaml: Yaml.serialize({ value: secret }),
        certPath,
        scope: opts.scope ?? "strict",
        timeout: opts.timeout
      }).pipe(Effect.mapError(_renderError(label)))
    })
  )

export const SealedSecrets = {
  backend: Backend.define({ tag: "SealedSecrets", requiresSource: true, emit: _emit })
}
