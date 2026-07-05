# @konfig.ts/docker

Workspace-graph-aware Dockerfile generator for konfig.ts monorepos. Write one
declarative spec next to your app; the package resolves the app's transitive
workspace closure and emits a production multi-stage Dockerfile and a dev
single-stage one — no hand-maintained `COPY` lists.

## Install

```bash
bun add -d @konfig.ts/docker
```

The app's `package.json` must set `engines.<runtime>` (e.g. `engines.bun`) —
that's where the runner image tag comes from. Missing it is a hard error
(`EngineVersionMissing`).

## Usage

Author the spec at `<app>/docker.ts`:

```ts
import { Docker } from "@konfig.ts/docker"

export default Docker.app({
  target: "apps/api",
  runner: {
    production: true, // re-install prod-only deps for the closure
    workdir: "/app/apps/api",
    copy: [Docker.copy.workspaceSourceAll()], // keep workspace source for bun's export conditions
    expose: 8080,
    cmd: ["bun", "run", "src/main.ts"]
  },
  dev: { cmd: ["bun", "--watch", "src/main.ts"], expose: 8080 }
})
```

Generate the Dockerfiles, then build with the **monorepo root** as the Docker
context (workspace `COPY`s only resolve from there):

```bash
konfig docker preview apps/api      # render to stdout
konfig docker write apps/api        # writes apps/api/Dockerfile + Dockerfile.dev
konfig docker diff apps/api         # non-zero exit if the on-disk files drifted

docker build -f apps/api/Dockerfile .
```

Production is a four-stage build (`base → deps → builder → runner`): `deps`
installs from the full workspace set, `builder` copies only the target's
closure and runs the build, `runner` is non-root, pinned to `engines.<runtime>`,
and copies only what the spec declares. Dev is a single `base → dev` stage.

## Spec atoms

| Family               | Constructors                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `Docker.app`         | `Docker.app(spec)` — the spec entrypoint                                                              |
| `Docker.copy`        | `builderArtifact(src, dst)`, `workspaceSource(name)`, `workspaceSourceAll()`, `path(src, dst, opts?)` |
| `Docker.runtime`     | `bun({ alpine? })`, `node({ alpine? })` — defaults from the PM; `alpine` defaults `true`              |
| `Docker.pm`          | `bun()`, `npm()`, `pnpm()` — optional; auto-detected from the root `package.json` + lockfile          |
| `Docker.build`       | `script(name)`, `command(argv)`, `none()` — defaults to `script("build")` if present                  |
| `Docker.healthcheck` | `httpGet({ path, port, … })`, `command(argv, opts?)`                                                  |
| `Docker.user`        | `nonRoot({ uid?, gid?, name? })`, `root()` — a non-root user is injected if you omit one              |
| `Docker.platform`    | `linuxAmd64()`, `linuxArm64()`, `multi(values)`                                                       |

## Scope

Emits Dockerfiles only — no image building, pushing, tagging, or signing, and no
BuildKit-specific syntax. `yarn` is not yet a supported PM. `AnyDockerError` is
the discriminated union of failure modes (`MonorepoRootNotFound`,
`EngineVersionMissing`, `CircularWorkspaceDep`, …).

## Requirements

konfig.ts is built on [Effect](https://effect.website/), currently in beta.
Until Effect ships a stable 4.x, install the exact beta konfig.ts is built
against:

- **`effect@4.0.0-beta.70`** — required by every package.
- **`@effect/platform-node@4.0.0-beta.70`** — required only when you call
  `render()` (the Node filesystem/subprocess entrypoint); manifest-only
  consumers can omit it (it is declared as an optional peer).

The pin is exact on purpose: Effect's beta line makes breaking changes between
builds, so a looser range surfaces as `ERESOLVE` install conflicts. It relaxes
to a caret range once Effect reaches a stable 4.x.
