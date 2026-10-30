import { Backend } from "@konfig.ts/k8s"
import { Effect } from "effect"
import { _kubesealArgs, resolveCertPath } from "./kubeseal"
import { SealedSecretSchema, type SealedSecretScope } from "./schema"

export interface SealedSecretsBackendOptions extends Backend.CliOptions {
  readonly scope?: SealedSecretScope
  readonly certPath?: string
}

export const SealedSecrets = {
  backend: Backend.encrypting({
    tag: "SealedSecrets",
    precheck: ({ label, opts }: { readonly opts: SealedSecretsBackendOptions; readonly label: string }) =>
      resolveCertPath({ certPath: opts.certPath, label }),
    toPlain: ({ base, opts, stringData }) => Backend.plainSecret({ base, type: opts.type ?? "Opaque", stringData }),
    bin: "kubeseal",
    args: ({ opts, pre }) => Effect.succeed(_kubesealArgs({ certPath: pre, scope: opts.scope ?? "strict" })),
    schema: SealedSecretSchema,
    schemaLabel: "SealedSecret"
  })
}
