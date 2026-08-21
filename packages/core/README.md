# @konfig.ts/core

The Kubernetes-agnostic primitives every other konfig.ts package builds on: the
`Manifest<A>` carrier, the `Dep.*` kinds that drive compile-time dependency
tracking, the `Module` factories, stable YAML, structural diff, a Helm
integration with digest verification, and the `render` entrypoint.

Most projects reach for the higher-level packages ([k8s](../k8s), [env](../env),
[argocd](../argocd)) and touch core directly only for `Helm.release`, `Dep.*`,
and `Module`.

## Install

```bash
bun add @konfig.ts/core
```

## Usage

Pull a digest-verified Helm chart inside a reusable module:

```ts
import { Application } from "@konfig.ts/argocd"
import { Dep, Helm, Module } from "@konfig.ts/core"
import { Namespace } from "@konfig.ts/k8s"

export const definePostgres = Module.fixedNs({
  target: Application.target,
  namespace: "data",
  build: ({ namespace }, opts: { storageGi: number }) => [
    Namespace.make({ name: namespace }),
    Helm.release({
      repo: "https://charts.bitnami.com/bitnami",
      chart: "postgresql",
      version: "16.0.0",
      digest: "sha256:…", // verified after pull AND on every cache hit
      namespace,
      values: { primary: { persistence: { size: `${opts.storageGi}Gi` } } }
    })
  ]
})
```

Inside a build, `yield* Dep.Secret("ghcr-pull")` records a typed dependency that
another module must provide — the graph is checked when you compose everything
at `AppOfApps.entrypoint` (see [`@konfig.ts/argocd`](../argocd)).

`Helm.release` caches the pulled tarball under
`<cacheDir>/<chart>-<version>-<digest12>.tgz`. `Helm.cacheFileName({ chart,
version, digest })` computes that name, and is the single naming rule
`@konfig.ts/cli`'s `konfig helm fetch` and `konfig crd extract` also use, so
a `helm fetch --all` actually warms the cache a render reads from.
`cacheDir` itself comes from `Config(KONFIG_HELM_CACHE)`, not a
`HelmReleaseOptions` field: `@konfig.ts/cli`'s `build`/`validate`/`diff`
commands install a `ConfigProvider` around the whole render (env var >
`konfig.json`'s `helm.cacheDir` > `.konfig/helm-cache`), so every
`Helm.release()` call across a project's chart definitions shares one
resolved cache directory. Outside the CLI (a bare Effect program calling
`render`/`renderManifest` directly), it falls back to the environment /
`.konfig/helm-cache` default like any other `Effect.Config` read.

## Surface

| Area        | Exports                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest    | `Manifest` (`.make` / `.combine` / `.concat` / `.whenever` / `.embedYaml`), `render`, `renderManifest`, `RenderContext`                                                       |
| Deps        | `Dep.*` kinds + `Dep.provide*` helpers; branded `SecretRef` / `ConfigMapRef` / `PvcRef` / `ServiceAccountRef` / `BuiltImageRef`                                               |
| Modules     | `Module.fixedNs`, `Module.dynamicNs`                                                                                                                                          |
| Helm        | `Helm.release` — chart pull + SHA-256 digest verification; `Helm.cacheFileName`, `Helm.verifyChartDigest`, the shared cache-naming/verification building blocks it's built on |
| YAML & diff | `Yaml.serialize` / `Yaml.filenameFor`; `diffFiles`, `formatDiff`, `parseYaml`, `redact`                                                                                       |
| Config      | `KonfigConfig`, `ImagesConfig`, and their decoders; `konfigDefaults.ts`'s `DEFAULT_*`/`KONFIG_*_ENV` constants                                                                |
| Boundaries  | `boundary` (Schema decode → `BoundaryDecodeError`); `brand` / `unsafeCoerce` escape hatches                                                                                   |
| Errors      | the tagged union `AnyRenderError` (`HelmDigestMismatch`, `BoundaryDecodeError`, …)                                                                                            |

## Internals

`Manifest<A>` is only a recipe from a `RenderContext` to an Effect that produces
an `A` — it does not track deps in its own type. Per-kind dependency tracking
lives one level up, in the Effect `Layer`s that `Module` and
`Application.define` compose. See
[`.docs/architecture.md`](../../.docs/architecture.md).

## Requirements

konfig.ts is built on [Effect](https://effect.website/), currently a release candidate.
Until Effect ships a stable 4.x, install a build from the rc line konfig.ts is
built against:

- **`effect@^4.0.0-rc.111`** — required by every package (declared as a peer
  dependency).
- **`@effect/platform-node@^4.0.0-rc.111`** — a regular (non-optional)
  dependency of `@konfig.ts/core`, since `render()` needs its Node
  filesystem/subprocess implementations. It is installed automatically
  whenever you install `@konfig.ts/core`.

The range floats within the rc line on purpose: Effect's pre-release line makes breaking
changes between builds, so a looser range surfaces as `ERESOLVE` install conflicts. It
widens to `^4.x` once Effect reaches a stable 4.x.
