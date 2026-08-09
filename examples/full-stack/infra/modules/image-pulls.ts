import { ghcrPull } from "@example/env-contracts"
import { Application, Sync } from "@konfig.ts/argocd"
import { Dep, Module } from "@konfig.ts/core"
import { Secret } from "@konfig.ts/k8s"
import { Sops } from "@konfig.ts/sops"

export interface ImagePullsOpts {
  readonly sopsBase: string
}

// Emits a SopsSecret for the GHCR pull credential, provided as `Dep.Secret("ghcr-pull")`.
// `Sops.passthrough` reads the encrypted yaml as-is (no `sops --encrypt` shell-out, works offline).
export const defineImagePulls = Module.fixedNs({
  target: Application.target,
  namespace: "app",
  annotations: Sync.wave(-1),
  provides: Dep.provideSecret("ghcr-pull"),
  build: (_ctx, opts: ImagePullsOpts) => {
    const bound = Secret.bind({
      secret: ghcrPull,
      backend: Sops.passthrough({
        file: `${opts.sopsBase}/SopsSecret-ghcr-pull.yaml`
      })
    })
    return bound.manifest === undefined ? [] : [bound.manifest]
  }
})
