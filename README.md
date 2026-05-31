# konfig.ts

Typesafe Kubernetes + ArgoCD configuration in TypeScript, powered by [Effect](https://effect.website/).

## Packages

| Package | Description |
| --- | --- |
| [`@konfig.ts/core`](./packages/core) | Core abstractions (Manifest, RenderContext, Helm, deps) |
| [`@konfig.ts/k8s`](./packages/k8s) | Kubernetes resource builders (workloads, network, identity, policy, volume, env) |
| [`@konfig.ts/env`](./packages/env) | Yieldable environment atoms (`defineSecret`, `defineLiteral`, `defineDownward`, `defineEnvironment`) shared between manifest emission and the runtime pod application |
| [`@konfig.ts/sops`](./packages/sops) | sops integration: `Sops.source` reads encrypted files at render time, `Sops.backend` emits `SopsSecret` CRs |
| [`@konfig.ts/sealed-secrets`](./packages/sealed-secrets) | `SealedSecret` CR backend; shells out to `kubeseal` at render time and emits `bitnami.com/v1alpha1` manifests |
| [`@konfig.ts/external-secrets`](./packages/external-secrets) | `ExternalSecret` CR backend; emits `external-secrets.io/v1beta1` manifests bound to atoms from `@konfig.ts/env` |
| [`@konfig.ts/argocd`](./packages/argocd) | ArgoCD `Application` / `AppOfApps` emitters |
| [`@konfig.ts/docker`](./packages/docker) | Workspace-graph-aware Dockerfile generator |
| [`@konfig.ts/cli`](./packages/cli) | `konfig` CLI: `build`, `validate`, `diff`, `set`, `docker` |

## Quickstart

```bash
bun install
bun run check
bun run test
bun run konfig --help
```
