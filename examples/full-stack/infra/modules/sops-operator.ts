import { Application, Sync } from "@konfig.ts/argocd"
import { Helm, Module } from "@konfig.ts/core"
import { Namespace } from "@konfig.ts/k8s"

// isindir/sops-secrets-operator — reconciles SopsSecret CRs into native Secrets. Sync-wave -2 so it lands before secrets (-1) and workloads (0).
export const defineSopsOperator = Module.fixedNs({
  target: Application.target,
  namespace: "sops",
  annotations: Sync.wave(-2),
  build: ({ namespace }, _opts: Record<never, never>) => {
    const ns = Namespace.make({ name: namespace })
    const release = Helm.release({
      repo: "https://isindir.github.io/sops-secrets-operator/",
      chart: "sops-secrets-operator",
      version: "0.19.0",
      digest: "sha256:e2a1cd7ef2c6fd53aad8fa49a1080d425c3648177a87fc20d5f9f6133cbb8e54",
      namespace,
      extraOpts: ["--include-crds"],
      values: {
        secretsAsFiles: [
          { name: "age-key", mountPath: "/etc/sops-age", secretName: "sops-age" }
        ],
        extraEnv: [{ name: "SOPS_AGE_KEY_FILE", value: "/etc/sops-age/age.key" }]
      }
    })
    return [ns, release]
  }
})
