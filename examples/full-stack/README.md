# Full-Stack Example

End-to-end konfig.ts demo. A Bun monorepo with two apps, a shared
`env-contracts` package, three Helm-based infra components, SOPS-encrypted
secrets, and an ArgoCD app-of-apps composed with compile-time dependency
checking.

Renders + type-checks offline. No cluster, no `sops` binary, no `helm`
binary required to read or check the code; running `bun konfig build`
will invoke `helm` to pull charts.

## Tree

```
examples/full-stack/
├── konfig.json                   # CLI entry: maps envs -> entry files
├── apps/
│   ├── api/                      # Bun HTTP server
│   │   ├── docker.ts             # @konfig.ts/docker multi-stage spec
│   │   └── src/main.ts
│   └── worker/                   # Bun background worker
│       ├── docker.ts
│       └── src/main.ts
├── shared/
│   └── env-contracts/            # the env-contract bundles
│       └── src/
│           ├── secrets.ts        # defineSecret: dbCreds, s3Creds, jwtKey, ghcrPull
│           └── bundles.ts        # apiEnv, workerEnv
└── infra/
    ├── cluster.ts                # cluster-wide constants
    ├── secrets/                  # encrypted SopsSecret yaml on disk
    ├── modules/
    │   ├── sops-operator.ts      # Helm: isindir/sops-secrets-operator
    │   ├── image-pulls.ts        # SopsSecret + Dep.provideSecret("ghcr-pull")
    │   ├── postgres.ts           # Helm: bitnami/postgresql
    │   ├── api.ts                # Workload + Environment.bind(apiEnv)
    │   └── worker.ts             # Workload + Environment.bind(workerEnv)
    └── envs/
        ├── prod.ts               # AppOfApps composition for prod
        ├── staging.ts            # AppOfApps composition for staging
        └── broken.ts             # @ts-expect-error: missing provider
```

## What it shows

**env-contracts shared across the monorepo.** `apps/api` and `apps/worker`
both import `apiEnv` / `workerEnv` from `@example/env-contracts`. The
same declaration covers (a) the runtime Effect Config decoder and (b)
the k8s Deployment env block. Both apps share `dbCreds`, so renaming
the env var name happens in exactly one place.

**Every contract atom.** `apiEnv` mixes `defineLiteral` (NODE_ENV),
`defineDownward` (POD_NAME via the k8s downward API), `defineSecret`
(db / s3 / jwt), and nested `defineEnvironment` groups (`http.port`,
`runtime.podName`).

**SOPS-encrypted secrets.** `Sops.passthrough` reads pre-encrypted
SopsSecret yaml under `infra/secrets/` and emits it verbatim. For
re-encrypt-on-render flows, swap `Sops.passthrough({ file })` for
`Sops.backend({ recipients })` + `Sops.source({ file, keys })` — the
empacthub `sopsBind` helper in `infra/konfig/modules/_helpers.ts` does
exactly that.

**Helm via `Helm.release`.** Both `sops-operator` and `postgres` lift a
Helm chart into the manifest stream. The release options (`repo`,
`chart`, `version`, `digest`, `values`) are typed; rendering shells out
to `helm template` and lifts each emitted YAML doc as a `RawYaml`
manifest under the parent Application.

**Docker generation.** `apps/api/docker.ts` and `apps/worker/docker.ts`
are `Docker.app` specs. Running `bun konfig docker write apps/api`
emits both production (multi-stage, prod-deps-only) and dev Dockerfiles
into the workspace. The runner stage automatically copies only the
transitive closure of the target workspace.

**App-of-apps with compile-time dep checking.** `infra/envs/prod.ts`
threads provider modules (`sopsOperator`, `imagePulls`, `postgres`)
through `Layer.provideMerge` before the consumers (`api`, `worker`).
Each consumer's `yield* Dep.Secret("ghcr-pull")` adds a type-level
`Need<"Secret", "ghcr-pull">` to its environment slot; `AppOfApps.entrypoint`
requires the program's environment to be `never`, so any missing
provider surfaces as a TypeScript error.

`infra/envs/broken.ts` shows what that error looks like — the
`@ts-expect-error` is satisfied by the missing `imagePulls` provider.

## Usage

```bash
# Type-check the whole example (validates the dep graph)
bun run --cwd examples/full-stack check

# Render prod manifests to .generated/manifests/prod/
bun run --cwd examples/full-stack build

# Generate Dockerfiles
bun run --cwd examples/full-stack docker:write

# Verify generated Dockerfiles match the spec
bun run --cwd examples/full-stack docker:diff
```

Run from the konfig.ts repo root after `bun install`.

## Notes on the SOPS files under infra/secrets/

The committed `SopsSecret-*.yaml` files contain syntactically valid
SOPS frames but with fake ENC blobs — they cannot be decrypted. They
exist so `Sops.passthrough` has something to read at render time. In a
real project these would be encrypted to the cluster's age recipient
and `sops` could decrypt them locally for development.
