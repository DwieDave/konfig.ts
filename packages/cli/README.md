# @konfig.ts/cli

The `konfig` command-line tool — render, validate, diff, and manage the
manifests described by your konfig.ts TypeScript sources. It's the front-end to
[`@konfig.ts/core`](../core), [`@konfig.ts/k8s`](../k8s),
[`@konfig.ts/argocd`](../argocd), and [`@konfig.ts/docker`](../docker).

## Install

```bash
bun add -d @konfig.ts/cli    # in a workspace that uses konfig.ts
bunx @konfig.ts/cli --help   # or run once, no install
```

The binary is exposed as `konfig`.

## Runtime requirement

Most commands `import()` your `.ts` sources at runtime (`konfig build prod`
loads the env entry file, which pulls in your modules and specs), so `konfig`
needs a **TypeScript-capable runtime**:

- **Bun** (recommended) — runs `.ts` with no flags.
- **Node ≥ 23.6** — native type stripping.
- **Node 22.6–23.5** — pass `--experimental-strip-types`.
- **`tsx`** — `tsx node_modules/.bin/konfig …`.

Pure-YAML commands that don't load your sources (e.g. `konfig diff` against a
baseline directory) run under plain Node.

## Configuration — `konfig.json`

Every command walks up from the cwd to find a `konfig.json`. Key fields:

| Field                               | Meaning                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `root`                              | directory (relative to `konfig.json`) holding your `env/`, `modules/`, and charts |
| `envs`                              | optional `<env> → { entry }` map overriding the default env-file path             |
| `outDir.manifests`                  | where rendered manifests are written                                              |
| `charts`                            | directory (relative to `konfig.json`) holding chart registry definitions          |
| `helm.cacheDir` / `helm.minVersion` | Helm tarball cache dir and minimum `helm` version (see precedence below)          |
| `crd.outDir`                        | where `konfig crd extract` writes generated CRD TypeScript                        |
| `diff.baseline`                     | baseline manifest tree for `konfig diff`                                          |
| `clusters`                          | per-cluster registry / ingressClass / storageClass / repositoryUrl                |

`konfig.json` is the source of truth for the Helm cache dir, the chart
registry dir, and the CRD codegen out dir. Each resolves with precedence
**env var > matching `konfig.json` field > built-in default** (defaults in
parentheses, all `konfig.json` fields resolved relative to the config file's
own directory, same as `root`/`outDir`):

- `KONFIG_HELM_CACHE` > `helm.cacheDir` > `.konfig/helm-cache`
- `KONFIG_CHARTS_DIR` > `charts` > `infra/k8s-konfig/charts`
- `KONFIG_CRD_OUT_DIR` > `crd.outDir` > `.generated/crd`
- `KONFIG_HELM_MIN_VERSION` > `helm.minVersion` > `3.16.0`

`konfig crd extract`/`konfig crd verify`/`konfig helm fetch` also work
outside a konfig project (no `konfig.json` found); every path then falls
back to the built-in default, resolved relative to `process.cwd()`, same as
before this precedence existed. `konfig build`/`validate`/`diff` always
require a `konfig.json` (to find the env entry file) and pass its resolved
`helm.cacheDir` through to every `Helm.release()` call a chart definition
makes, via a `ConfigProvider` installed around the render (see
[`@konfig.ts/core`](../core)'s README for how `Helm.release` reads it).

An **env** is a named render target (`prod`, `staging`). Its entry file is
`envs.NAME.entry`, else `<root>/env/NAME.ts`; that module's **default export**
must be an `AppOfApps` program (see [`@konfig.ts/argocd`](../argocd)).

## Commands

```bash
konfig build <env>       # render manifests to outDir (input-hashed; a no-op build rewrites nothing)
konfig validate <env>    # render in-memory + structural checks; --strict adds kubeconform
konfig diff <env>        # structural diff vs. the configured baseline (ignores key reordering)
konfig set <env> <app> <imageRef> [--create]   # update one image tag in images.json; --create adds a new app key
konfig crd extract|verify           # CRD TypeScript codegen from Helm charts
konfig helm fetch --all             # pre-fetch chart tarballs into the cache
konfig docker preview|write|diff <app>   # Dockerfile generation (@konfig.ts/docker)
konfig graph [target] [--with-dev] [--full] [--width <n>]   # print the workspace dependency graph
```

`build` / `validate` / `diff` share `--cluster <name>`, `--k8s-version <ver>`,
and repeatable `--flag k=v`, all readable from your program's `RenderContext`.

`konfig helm fetch --all` and `konfig crd extract` cache tarballs under the
_same_ filename `Helm.release` uses at render time: `<chart>-<version>.tgz`
for a chart registry entry with no recorded digest, or
`<chart>-<version>-<digest12>.tgz` once a digest is known (verified against
the pulled bytes before the file is cached under that name). A chart with a
digest that `helm fetch`d without one (before the digest was recorded)
prints a warning that the plain-named tarball won't be reused by a render;
re-run `konfig helm fetch --all` after adding the digest to warm the correct
cache slot. `konfig crd extract` looks for the digest-suffixed tarball first
when a digest is known, so a prior `helm fetch` (or a prior render) already
warms its cache too.

## Requirements

konfig.ts is built on [Effect](https://effect.website/), currently a release candidate.
Until Effect ships a stable 4.x, the CLI accepts any build from the rc line it is
built against and installs them as direct dependencies:

- **`effect@^4.0.0-rc.111`**
- **`@effect/platform-node@^4.0.0-rc.111`** — the CLI uses `render()` and the
  Node filesystem/subprocess services.

The range floats within the rc line on purpose: Effect's pre-release line makes breaking
changes between builds, so it never crosses into another prerelease line or a stable
major — but every rc from rc.111 on is supported. It widens to `^4.x` once Effect
reaches a stable 4.x.
