# @konfig.ts/external-secrets

[External Secrets](https://external-secrets.io) backend for konfig.ts. Emits an
`ExternalSecret` CR that the in-cluster External Secrets Operator reconciles
into a normal `Secret` by pulling values from an external store (AWS Secrets
Manager, GCP Secret Manager, Vault, 1Password, …).

konfig never touches the values (`requiresSource: false`) — they live entirely
in the external store.

## Install

```bash
bun add @konfig.ts/external-secrets
```

## Usage

Bind a secret contract (`Secret.define`, from `@konfig.ts/env`) to the backend.
No `source` is needed — the values stay in the store:

```ts
import { ExternalSecrets } from "@konfig.ts/external-secrets"
import { Secret } from "@konfig.ts/k8s"

const dbCreds = Secret.define({
  name: "db-creds",
  namespace: "prod",
  env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" }
})

const bound = Secret.bind({
  secret: dbCreds,
  backend: ExternalSecrets.backend({
    secretStoreRef: { name: "aws-prod", kind: "ClusterSecretStore" },
    refreshInterval: "1h",
    remoteRef: (key) => ({ key: `prod/api/${key}` })
  })
})
// bound.manifest is the ExternalSecret CR.
```

## Options

| Field                 | Default                    | Notes                                                 |
| --------------------- | -------------------------- | ----------------------------------------------------- |
| `secretStoreRef.name` | required                   | name of the `SecretStore` / `ClusterSecretStore`      |
| `secretStoreRef.kind` | `"SecretStore"`            | use `"ClusterSecretStore"` for cluster-scoped stores  |
| `refreshInterval`     | ESO default                | reconcile cadence, e.g. `"1h"`, `"30m"`               |
| `remoteRef`           | identity (`key → { key }`) | map each contract key to its path in the store        |
| `target`              | omitted                    | `ExternalSecret` `target` (template / creationPolicy) |

## Internals

Backends implement the `SecretBackend<N, K, RequiresSource>` contract from
`@konfig.ts/k8s`; this one declares `requiresSource: false`, so no plaintext
source is needed at render time. See the `Environment` section of
[`.docs/architecture.md`](../../.docs/architecture.md).

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
