# konfig.ts

Typesafe Kubernetes + ArgoCD configuration in TypeScript, powered by [Effect](https://effect.website/).

## Packages

- `@konfig.ts/core` — core abstractions (Manifest, RenderContext, Helm, deps)
- `@konfig.ts/k8s` — Kubernetes resource builders (workloads, network, identity, policy, volume, env)
- `@konfig.ts/argocd` — ArgoCD `Application` / `AppOfApps` emitters
- `@konfig.ts/cli` — `konfig` CLI: `build`, `validate`, `diff`, `set`

## Quickstart

```bash
bun install
bun run check
bun run test
bun run konfig --help
```
