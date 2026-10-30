import { Manifest } from "@konfig.ts/core"
import {
  type BackendEmitInput,
  backendLabel,
  type EmitInput,
  encryptVia,
  plainSecret,
  SecretBackend
} from "@konfig.ts/k8s"
import { type Duration, Effect } from "effect"
import type { SealedSecret, SealedSecretScope } from "./crd"
import { parseSealed, resolveCertPath, runKubeseal } from "./kubeseal"

export interface SealedSecretsBackendOptions {
  readonly scope?: SealedSecretScope
  readonly certPath?: string
  readonly type?: string
  readonly timeout?: Duration.Input
}

const _emit = <N extends string, K extends string>(
  input: EmitInput<N, K, SealedSecretsBackendOptions>
): Manifest.Manifest<SealedSecret> =>
  Manifest.make<SealedSecret>((_ctx) => {
    const label = backendLabel({ tag: "SealedSecrets", base: input.base })

    return resolveCertPath({ certPath: input.opts.certPath, label }).pipe(
      Effect.flatMap((certPath) =>
        encryptVia({
          base: input.base,
          label,
          toPlain: (stringData) => plainSecret({ base: input.base, type: input.opts.type ?? "Opaque", stringData }),
          encrypt: (plainYaml) =>
            runKubeseal({
              plainYaml,
              certPath,
              scope: input.opts.scope ?? "strict",
              timeout: input.opts.timeout,
              label
            }),
          verify: (stdout) => parseSealed({ stdout, label })
        })
      )
    )
  })

export const SealedSecrets = {
  backend: <N extends string, K extends string>(
    opts: SealedSecretsBackendOptions = {}
  ): SecretBackend<N, K, true, SealedSecret> =>
    SecretBackend.make({
      tag: "SealedSecrets",
      requiresSource: true,
      emit: (base: BackendEmitInput<N, K, true>) => _emit({ base, opts })
    })
}
