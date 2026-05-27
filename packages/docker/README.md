# @konfig.ts/docker

Workspace-graph-aware Dockerfile generator for konfig.ts monorepos. Write a
single declarative spec next to your target's `package.json`; the package
resolves the transitive workspace closure and emits both the production
multi-stage Dockerfile and the development single-stage Dockerfile.

Backed by [Effect](https://effect.website/), built on the same patterns as
`@konfig.ts/core` (`Manifest`, `Schema`, tagged errors, `Effect.Service`).

## Quickstart

1. Install the package as a `devDependency` in the target workspace:

   ```jsonc
   // apps/my-app/package.json
   {
     "name": "@my/app",
     "engines": {
       "bun": "1.3.5"
     },
     "scripts": {
       "build": "tsc -p tsconfig.json"
     },
     "devDependencies": {
       "@konfig.ts/docker": "workspace:*"
     }
   }
   ```

   The `engines.<runtime>` field is **required** — that's where the runner
   image tag comes from. Missing it is a hard error (`EngineVersionMissing`).
   For `bun PM + bun runtime`, a single `engines.bun` field covers both.

2. Author the spec at `apps/my-app/docker.ts`:

   ```ts
   import { Docker } from "@konfig.ts/docker";

   export default Docker.app({
     target: "apps/my-app",
     runner: {
       workdir: "/app/apps/my-app",
       copy: [
         Docker.copy.builderArtifact("dist", "dist"),
         Docker.copy.workspaceSourceAll(),   // for bun's "bun"/"source" export condition
       ],
       expose: 4000,
       cmd: ["bun", "run", "dist/main.js"],
     },
     dev: {
       cmd: ["bun", "--watch", "main.ts"],
       expose: 4000,
     },
   });
   ```

3. Generate:

   ```
   bun konfig docker write apps/my-app
   ```

   This emits `apps/my-app/Dockerfile` and `apps/my-app/Dockerfile.dev`.
   Build with the **monorepo root** as the docker context:

   ```
   docker build -f apps/my-app/Dockerfile .
   ```

## CLI

| Command | Purpose |
|---|---|
| `konfig docker preview <target> [--prod-only|--dev-only]` | Render Dockerfile(s) to stdout |
| `konfig docker write <target> [--out-dir <dir>] [--prod-only|--dev-only] [--force]` | Atomically write `Dockerfile` + `Dockerfile.dev`. Refuses to overwrite a destination missing the `# konfig-managed:` marker unless `--force` is passed. Skips the rename when on-disk + emitted match (idempotent re-runs). |
| `konfig docker diff <target> [--format summary|detail|json]` | Diff would-emit vs on-disk; non-zero exit on drift. Hash fast-path skips re-rendering when the generation header hash matches. |

The CLI also takes a global `--debug` flag (matches `konfig build|diff`).

## Atom reference

Every atom returns a tagged data object validated by the spec Schema.

| Family | Constructors | Notes |
|---|---|---|
| `Docker.app` | `Docker.app(spec)` | Wraps the spec in a `DockerApp` brand. |
| `Docker.pm` | `bun()`, `npm()`, `pnpm()` | Optional; auto-detected from root `package.json#packageManager` + lockfile. |
| `Docker.runtime` | `bun({alpine?})`, `node({alpine?})` | Optional; defaults to `bun` for bun PM, `node` for npm/pnpm. `alpine` defaults to `true`. |
| `Docker.build` | `script(name)`, `command(argv)`, `none()` | Optional; defaults to `script("build")` if target has one, else `none()`. |
| `Docker.copy` | `builderArtifact(src, dst, {chown?})`, `workspaceSource(name)`, `workspaceSourceAll()`, `path(src, dst, {from?, chown?})` | `workspaceSourceAll` expands to per-workspace `workspaceSource` for every closure member except the target. |
| `Docker.healthcheck` | `httpGet({path, port, interval?, timeout?, retries?, startPeriod?})`, `command(argv, opts?)` | |
| `Docker.user` | `nonRoot({uid?, gid?, name?})`, `root()` | Lower injects `nonRoot()` if the user does not specify one. Defaults: uid/gid 1001, name "app". |
| `Docker.platform` | `linuxAmd64()`, `linuxArm64()`, `multi(values)` | Single platforms become `--platform=...` on `FROM`. v1 does not emit buildx-specific syntax for `multi(...)`. |

## What the package generates

Production: four stages — `base → deps → builder → runner`.

- `base` pins the runtime image from `engines.<runtime>`.
- `deps` copies **every** workspace `package.json` in the monorepo (this is
  required — npm/bun/pnpm refuse to install if any workspace is missing),
  then runs the install command (`bun install --ignore-scripts`,
  `npm ci --ignore-scripts`, or `pnpm install --frozen-lockfile --ignore-scripts`).
- `builder` copies the **transitive workspace closure**'s `node_modules`
  from the `deps` stage (per-workspace, or single-root for pnpm hoisted),
  copies the closure's source trees, and runs the build script.
- `runner` runs as a non-root user (uid 1001 by default), sets
  `NODE_ENV=production` unless overridden, exposes the declared ports,
  copies what the spec declared, and runs the declared command.

Development: two stages — `base → dev` — installs everything inline and
runs the `dev.cmd`.

## Best-practice defaults (AC-8)

- Non-root `USER` with `addgroup -S / adduser -S` (alpine-native).
- `node_modules` and source COPYs are per-workspace, not `COPY . .`.
- No `:latest` tags; every image is pinned via `engines.<runtime>`.
- `CMD` in JSON-array (exec) form.
- No build-time tools leak into the runner — runner copies only what the
  spec declares.

## Errors

`AnyDockerError` is a discriminated union of 11 variants:
`MonorepoRootNotFound`, `WorkspaceNotFound`, `UnsupportedPm`,
`CircularWorkspaceDep`, `EngineVersionMissing`, `SpecDecodeError`,
`BuildScriptMissing`, `WorkspaceSourceUnknown`, `SharedRootFileMissing`,
`DockerWriteRefused`, `DockerWriteError`.

## FAQ

**Why `engines.<runtime>` instead of a Corepack `packageManager` field?**

Corepack works fine for detecting which PM you're using, but pinning the
runtime image tag is a separate, image-level concern. `engines` is the
existing source of truth most monorepos already maintain, and making it
required forces the version to live in one obvious place.

**Why does the deps stage copy every workspace, not just the closure?**

All three v1 PMs (bun, npm, pnpm) refuse to run `install` if any workspace
listed in the root manifest is missing from disk. The deps stage's purpose
is to get the install working; it has to mirror the full workspace set.
Only the **builder** stage's `node_modules` and source COPYs are scoped to
the closure.

**Why is `workspaceSource(...)` explicit instead of auto-detected?**

Bun's `"bun"` / `"source"` export conditions resolve `workspace:*` imports
to `./src/index.ts` at runtime, which means some images need to keep the
workspace source trees alongside the prebuilt `dist/`. There's no reliable
static signal that says "this image needs source at runtime" — parsing
every transitive `exports` block is flaky. So the spec author opts in
explicitly with `Docker.copy.workspaceSource(name)` or
`Docker.copy.workspaceSourceAll()`.

**Why is the build context the monorepo root?**

Workspace COPYs only work from there — `apps/foo/Dockerfile`'s reference
to `references/konfig.ts/packages/core` is meaningless from the
`apps/foo/` directory. The CLI's `write` command emits a comment noting
this; build with `docker build -f apps/foo/Dockerfile <monorepo-root>`.

## Non-goals (v1)

- Image building, pushing, tagging, signing — the package only emits
  Dockerfiles.
- BuildKit-specific syntax (`# syntax=`, `--mount=type=cache`,
  `--mount=type=secret`, heredocs).
- The `yarn` PM (admits future addition as a sibling impl).
- Auto-detection of `workspaceSource` requirements.
- Auto-detection of exposed ports.
- External-dependency pruning (`bun install --filter`, `pnpm deploy`).
- `.dockerignore` generation.
- Multi-arch buildx orchestration (the platform atom sets `--platform`,
  not buildx invocation).

## License

MIT
