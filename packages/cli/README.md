# @konfig.ts/cli

The `konfig` command-line tool: render, validate, diff, and manage the
manifests described by your konfig.ts TypeScript sources. It is the
imperative front-end to `@konfig.ts/core`, `@konfig.ts/k8s`,
`@konfig.ts/argocd`, and `@konfig.ts/docker`.

## Install

```bash
# add to a workspace that already uses konfig.ts
bun add -d @konfig.ts/cli

# or run once, no install
bunx @konfig.ts/cli --help
```

The binary is exposed as `konfig`:

```bash
konfig --help
konfig --version
```

## Runtime requirement

`konfig` ships as an ESM Node binary (`#!/usr/bin/env node`, `engines.node

> = 20`). But most commands **import your TypeScript sources at runtime** —`konfig build prod`dynamically`import()`s the env entry`.ts`file, which
in turn pulls in your modules and`docker.ts`/`cluster.ts` specs. That means
> the CLI must run under a **TypeScript-capable runtime**:

- **Bun** (recommended) — `bun konfig build prod`, or invoke the bin
  directly; Bun runs `.ts` with no extra flags.
- **Node ≥ 23.6** — native type stripping, no flag needed.
- **Node 22.6–23.5** — pass `--experimental-strip-types`.
- **`tsx`** — `tsx node_modules/.bin/konfig build prod`.

Pure-YAML commands that do not load your sources (e.g. `konfig diff` against
a baseline directory) work under plain Node.

## Configuration — `konfig.json`

Every command resolves a `konfig.json` by walking up from the current
directory until one is found. Key fields:

| Field                               | Meaning                                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| `root`                              | Directory (relative to `konfig.json`) that holds your `env/`, `modules/`, `cluster.ts`, and charts. |
| `envs`                              | Optional map of `<env> → { entry }` overriding the default env-file path.                           |
| `outDir.manifests`                  | Where rendered manifests are written.                                                               |
| `crd.outDir`                        | Destination for generated CRD types (default `.generated/crd`).                                     |
| `helm.cacheDir` / `helm.minVersion` | Helm tarball cache and minimum `helm` version (defaults `.konfig/helm-cache`, `3.16.0`).            |
| `diff.baseline`                     | Baseline manifest tree for `konfig diff`.                                                           |
| `clusters`                          | Per-cluster registry / ingressClass / storageClass / repositoryUrl.                                 |

### Env-file conventions

An **env** is a named render target (e.g. `prod`, `staging`). For an env
`NAME`, the CLI resolves its entry file as:

1. `envs.NAME.entry` from `konfig.json`, if present; otherwise
2. the convention `<root>/env/NAME.ts`.

The entry module's **default export** must be an `AppOfApps` program (from
`@konfig.ts/argocd`) or a `Bundle` program — the contract documented in
[`@konfig.ts/core`](../core/README.md). Rendering runs that Effect program
and writes one directory tree of manifests per Application under
`outDir.manifests`.

### Environment variables

These override the corresponding `konfig.json` values (env var wins):

| Variable                  | Default                   |
| ------------------------- | ------------------------- |
| `KONFIG_HELM_CACHE`       | `.konfig/helm-cache`      |
| `KONFIG_CRD_OUT_DIR`      | `.generated/crd`          |
| `KONFIG_CHARTS_DIR`       | `infra/k8s-konfig/charts` |
| `KONFIG_HELM_MIN_VERSION` | `3.16.0`                  |

## Commands

### `konfig build <env>`

Render the manifests for an env to `outDir.manifests`. Input-hashed: a
second build with unchanged inputs is a cache hit and rewrites nothing.

```bash
konfig build prod
konfig build prod --log json          # machine-readable log lines
konfig build prod --no-cache          # force a fresh render
konfig build prod --verbose           # Effect tracing
konfig build prod --cluster eu-west --k8s-version 1.31 --flag tier=gold
```

`--cluster`, `--k8s-version`, and repeatable `--flag k=v` populate the
`RenderContext` your program reads via `ctx.flags.get(k)`.

### `konfig validate <env>`

Render in-memory and run structural validation on the result without
writing files — a fast pre-flight for CI.

### `konfig diff <env>`

Structural diff of the would-render output against the configured baseline
(`diff.baseline`), ignoring key reordering and Helm-volatile metadata.
Supports `--format`. Non-empty diffs are reported per file.

### `konfig set <env> <app> <imageRef>`

Update one image tag in `images.json` (Schema-validated read + write). E.g.

```bash
konfig set prod api ghcr.io/acme/api:sha-1a2b3c4
```

### `konfig crd`

CRD TypeScript codegen from Helm charts.

```bash
konfig crd extract --all           # extract types for every chart
konfig crd extract --release argo  # a single chart release
konfig crd verify                  # fail if committed types are stale
```

### `konfig helm`

Helm chart management.

```bash
konfig helm fetch --all            # pre-fetch chart tarballs into the cache
```

### `konfig docker`

Generate `Dockerfile` + `Dockerfile.dev` from a target's `docker.ts` spec,
resolving workspace-graph dependencies via `@konfig.ts/docker`.

```bash
konfig docker preview apps/api            # render to stdout
konfig docker preview apps/api --prod     # prod Dockerfile only
konfig docker write apps/api              # write next to the target
konfig docker write apps/api --out build/ --force
konfig docker diff apps/api               # non-zero exit on drift
```

### `konfig graph`

Draw the workspace dependency graph.

```bash
konfig graph                       # dependency edges
konfig graph --dev                 # include devDependency edges (▽)
```

## Requirements

konfig.ts is built on [Effect](https://effect.website/), which is still in
beta. Until Effect ships a stable 4.x, the CLI is pinned to the exact beta it
is developed against and installs them as direct dependencies:

- **`effect@4.0.0-beta.70`**
- **`@effect/platform-node@4.0.0-beta.70`** — the CLI uses `render()` and the
  Node filesystem/subprocess services.

The pin is exact on purpose: Effect's beta line makes breaking changes
between builds, so a looser range would surface as `ERESOLVE` install
conflicts. It will relax to a caret range once Effect reaches a stable 4.x.
