# @konfig.ts/sealed-secrets

`SealedSecret` CR backend powered by `kubeseal`.

## What it does

Pairs with `Secret.bind` / `Environment.bind` from `@konfig.ts/k8s` to
emit `bitnami.com/v1alpha1` `SealedSecret` manifests. At render time
konfig:

1. Resolves the bound `SecretSource` to plaintext values (held only in
   `Redacted<string>` in-memory).
2. Constructs a plain `Secret` manifest.
3. Pipes it to `kubeseal` over stdin with the configured public cert.
4. Parses the returned YAML and emits the `SealedSecret` CR.

The plaintext never lands on disk. The encrypted payload that _does_ is
safe to commit because only the in-cluster sealed-secrets controller's
private key can decrypt it.

## Host-tool requirement

Requires the `kubeseal` CLI on the konfig host. Cert resolution order:

1. `opts.certPath`
2. `$KUBESEAL_CERT` env var

If neither is present the render fails fast with `KubesealCertMissing`.

## Usage

```ts
import { defineSecret, SecretSource } from "@konfig.ts/env"
import { Secret } from "@konfig.ts/k8s"
import { SealedSecrets } from "@konfig.ts/sealed-secrets"

const dbCreds = defineSecret({
  name: "db-creds",
  namespace: "prod",
  env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" }
})

const bound = Secret.bind({
  secret: dbCreds,
  backend: SealedSecrets.backend({ scope: "strict" }),
  source: SecretSource.fromConfig({
    keys: ["url", "password"] as const,
    envName: (k) => `DB_${k.toUpperCase()}`
  })
})
```

## Options

| Field      | Default          | Notes                                                                                                                   |
| ---------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `scope`    | `"strict"`       | `strict` requires same name + namespace; `namespace-wide` allows rename within ns; `cluster-wide` allows move across ns |
| `certPath` | `$KUBESEAL_CERT` | path to the sealed-secrets controller's public cert                                                                     |

## Status

Phase 3b of the secret refactor — see `.docs/secret-refactoring/plan.md`.

## Requirements

konfig.ts builds on [Effect](https://effect.website/), which is still in
beta. Until Effect ships a stable 4.x, you must install the exact beta
konfig is developed against:

- **`effect@4.0.0-beta.70`** — required.
- **`@effect/platform-node@4.0.0-beta.70`** — required only for `render()`
  (the Node filesystem/subprocess entrypoint); manifest-only consumers can
  omit it.

The peer dependency is pinned to the exact version on purpose: Effect's beta
line makes breaking changes between builds, so a looser range would surface
as `ERESOLVE` install conflicts rather than a working install. This pin will
relax to a caret range once Effect reaches a stable 4.x.
