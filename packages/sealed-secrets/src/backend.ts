import { Manifest, RenderError, Yaml } from "@konfig.ts/core"
import { type BackendEmitInput, type EmitInput, resolvePlaintext, type SecretBackend } from "@konfig.ts/k8s"
import { Data, Effect } from "effect"
import type { SealedSecret, SealedSecretScope } from "./crd"
import { resolveCertPath, runKubeseal } from "./kubeseal"

export interface SealedSecretsBackendOptions {
  readonly scope?: SealedSecretScope
  readonly certPath?: string
  readonly type?: string
}

const _toRenderError = (
  base: { readonly namespace: string; readonly name: string },
  detail: string
) =>
(cause: unknown) => new RenderError({ message: `SealedSecrets(${base.namespace}/${base.name}): ${detail}`, cause })

const _plainSecret = <N extends string, K extends string>(
  input: EmitInput<N, K, SealedSecretsBackendOptions>,
  stringData: Record<string, string>
) => ({
  apiVersion: "v1" as const,
  kind: "Secret" as const,
  metadata: {
    name: input.base.name,
    namespace: input.base.namespace,
    labels: input.base.labels,
    annotations: input.base.annotations
  },
  type: input.opts.type ?? "Opaque",
  stringData
})

const _emit = <N extends string, K extends string>(
  input: EmitInput<N, K, SealedSecretsBackendOptions>
): Manifest.Manifest<SealedSecret> =>
  Manifest.make<SealedSecret>((_ctx) =>
    Effect.gen(function*() {
      const certPath = yield* resolveCertPath({ certPath: input.opts.certPath }).pipe(
        Effect.mapError(_toRenderError(input.base, "cert missing"))
      )

      const stringData = yield* resolvePlaintext({
        base: input.base,
        label: `SealedSecrets(${input.base.namespace}/${input.base.name})`
      })

      return yield* runKubeseal({
        plainSecretYaml: Yaml.serialize({ value: _plainSecret(input, stringData) }),
        certPath,
        scope: input.opts.scope ?? "strict"
      }).pipe(Effect.mapError(_toRenderError(input.base, "kubeseal failed")))
    })
  )

class _SealedSecretsBackend<N extends string, K extends string> extends Data.TaggedClass("SealedSecrets")<{
  readonly requiresSource: true
  readonly emit: (input: BackendEmitInput<N, K, true>) => Manifest.Manifest<SealedSecret>
}> {}

export const SealedSecrets = {
  backend: <N extends string, K extends string>(
    opts: SealedSecretsBackendOptions = {}
  ): SecretBackend<N, K, true, SealedSecret> =>
    new _SealedSecretsBackend({ requiresSource: true, emit: (input) => _emit({ base: input, opts }) })
}
