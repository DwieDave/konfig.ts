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

| Field                               | Meaning                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `root`                              | directory (relative to `konfig.json`) holding your `env/`, `modules/`, and charts                                  |
| `envs`                              | optional `<env> → { entry }` map overriding the default env-file path                                              |
| `outDir.manifests`                  | where rendered manifests are written                                                                               |
| `helm.cacheDir` / `helm.minVersion` | accepted by the schema, but not read yet: `helm fetch`, `crd` and `Helm.release` use the `KONFIG_*` env vars below |
| `diff.baseline`                     | baseline manifest tree for `konfig diff`                                                                           |
| `clusters`                          | per-cluster registry / ingressClass / storageClass / repositoryUrl                                                 |

Paths for the Helm cache, chart registry and CRD codegen come from environment
variables (defaults in parentheses): `KONFIG_HELM_CACHE` (`.konfig/helm-cache`),
`KONFIG_CHARTS_DIR` (`infra/k8s-konfig/charts`), `KONFIG_CRD_OUT_DIR`
(`.generated/crd`), `KONFIG_HELM_MIN_VERSION` (`3.16.0`).

An **env** is a named render target (`prod`, `staging`). Its entry file is
`envs.NAME.entry`, else `<root>/env/NAME.ts`; that module's **default export**
must be an `AppOfApps` program (see [`@konfig.ts/argocd`](../argocd)).

## Commands

```bash
konfig build <env>       # render manifests to outDir (input-hashed; a no-op build rewrites nothing)
konfig validate <env>    # render in-memory + structural checks; --strict adds kubeconform
konfig diff <env>        # structural diff vs. the configured baseline (ignores key reordering)
konfig set <env> <app> <imageRef>   # update one image tag in images.json
konfig crd extract|verify           # CRD TypeScript codegen from Helm charts
konfig helm fetch --all             # pre-fetch chart tarballs into the cache
konfig docker preview|write|diff <app>   # Dockerfile generation (@konfig.ts/docker)
konfig graph [target] [--with-dev] [--full] [--width <n>]   # print the workspace dependency graph
```

`build` / `validate` / `diff` share `--cluster <name>`, `--k8s-version <ver>`,
and repeatable `--flag k=v`, all readable from your program's `RenderContext`.

## Requirements

konfig.ts is built on [Effect](https://effect.website/), currently a release candidate.
Until Effect ships a stable 4.x, the CLI pins the exact pre-release it is built against
and installs them as direct dependencies:

- **`effect@4.0.0-rc.109`**
- **`@effect/platform-node@4.0.0-rc.109`** — the CLI uses `render()` and the
  Node filesystem/subprocess services.

The pin is exact on purpose: Effect's pre-release line makes breaking changes between
builds, so a looser range surfaces as `ERESOLVE` install conflicts. It relaxes
to a caret range once Effect reaches a stable 4.x.
