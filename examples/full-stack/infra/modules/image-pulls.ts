import { Application, Sync } from "@konfig.ts/argocd";
import { Dep, Module } from "@konfig.ts/core";
import { Secret } from "@konfig.ts/k8s";
import { Sops } from "@konfig.ts/sops";
import { ghcrPull } from "@example/env-contracts";

export interface ImagePullsOpts {
	readonly sopsBase: string;
}

/**
 * Emits a SopsSecret for the GHCR pull credential and declares the
 * resulting Secret as a provider of `Dep.Secret("ghcr-pull")`.
 *
 * Demonstrates two konfig.ts patterns:
 *  1. `Secret.bind` for a standalone Secret that's NOT exposed as
 *     container env vars (it's only used via `imagePullSecrets`). The
 *     bind handle still emits the manifest and exposes the SecretRef
 *     for downstream Application modules to mount.
 *  2. `Sops.passthrough` — reads the encrypted yaml on disk and emits
 *     it as the SopsSecret manifest verbatim. No `sops --encrypt` shell-
 *     out at render time, so this works offline. To re-encrypt on every
 *     render, swap for `Sops.backend({ recipients })` + `Sops.source`.
 */
export const defineImagePulls = Module.fixedNs({
	target: Application.target,
	namespace: "app",
	annotations: Sync.wave(-1),
	provides: Dep.provideSecret("ghcr-pull"),
	build: (_ctx, opts: ImagePullsOpts) => {
		const bound = Secret.bind({
			secret: ghcrPull,
			backend: Sops.passthrough({
				file: `${opts.sopsBase}/SopsSecret-ghcr-pull.yaml`,
			}),
		});
		return bound.manifest === undefined ? [] : [bound.manifest];
	},
});
