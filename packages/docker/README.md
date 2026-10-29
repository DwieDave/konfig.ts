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
    production: true, // install prod-only deps for the closure
    workdir: "/app/apps/api",
    copy: [Docker.copy.workspaceSourceAll()], // target + workspace deps' source, for bun's export conditions
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

Production is a multi-stage build (`base → deps → builder → runner`, plus a
`prod-deps` stage when `runner.production` is `true`): `deps` installs from the
full workspace set, `builder` copies only the target's closure and runs the
build, `prod-deps` re-installs production-only dependencies for that closure,
`runner` is non-root, pinned to `engines.<runtime>`, and copies only what the
spec declares. Dev is a single `base → dev` stage.

With bun, `prod-deps` installs from the committed `bun.lock` via
`bun install --frozen-lockfile --production --filter <target>`, so production
images get exactly the locked versions. This needs `engines.bun` ≥ 1.2
(otherwise lowering fails with `BunVersionUnsupported`) and an up-to-date
`bun.lock`: a stale lockfile fails the image build.

## Spec atoms

| Family               | Constructors                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `Docker.app`         | `Docker.app(spec)` — the spec entrypoint                                                                           |
| `Docker.copy`        | `builderArtifact(src, dst)`, `workspaceSource(name)`, `workspaceSourceAll()`, `path(src, dst, opts?)`              |
| `Docker.runtime`     | `bun({ alpine? })`, `node({ alpine? })` — defaults from the PM; `alpine` defaults `true`                           |
| `Docker.pm`          | `bun()`, `npm()`, `pnpm()`, `yarn({ variant? })` — optional; auto-detected from the root `package.json` + lockfile |
| `Docker.build`       | `script(name)`, `command(argv)`, `none()` — defaults to `script("build")` if present                               |
| `Docker.healthcheck` | `httpGet({ path, port, … })`, `command(argv, opts?)`                                                               |
| `Docker.user`        | `nonRoot({ uid?, gid?, name? })`, `root()` — a non-root user is injected if you omit one                           |
| `Docker.platform`    | `linuxAmd64()`, `linuxArm64()`, `multi(values)`                                                                    |

`workspaceSourceAll()` expands to one workspace-source `COPY` per workspace in
the target's closure, **including the target itself** — its own source is
what makes a `cmd`/`entrypoint` that runs from source (e.g.
`bun run src/main.ts`) actually work in the runner. If your build instead
produces a bundled artifact, skip `workspaceSourceAll()`/`workspaceSource()`
for the target and copy the artifact explicitly with
`Docker.copy.builderArtifact()` instead.

## Scope

Emits Dockerfiles only — no image building, pushing, tagging, or signing, and no
BuildKit-specific syntax. `AnyDockerError` is
the discriminated union of failure modes (`MonorepoRootNotFound`,
`EngineVersionMissing`, `CircularWorkspaceDep`, …).

## Requirements

konfig.ts is built on [Effect](https://effect.website/) 4. Any 4.x build from 4.0.0 on
is supported:

- **`effect@^4.0.0`** — peer dependency of every package.
- **`@effect/platform-node@^4.0.0`** — peer dependency of `@konfig.ts/core`,
  whose `render()` entrypoint needs the Node filesystem/subprocess services.
  Install it next to `effect` and keep both on the same minor version.
