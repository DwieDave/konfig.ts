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

| Field                 | Default                    | Notes                                                                                                          |
| --------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `secretStoreRef.name` | required                   | name of the `SecretStore` / `ClusterSecretStore`                                                               |
| `secretStoreRef.kind` | `"SecretStore"`            | use `"ClusterSecretStore"` for cluster-scoped stores                                                           |
| `refreshInterval`     | ESO default                | reconcile cadence, e.g. `"1h"`, `"1h30m"`, `"0"`                                                               |
| `remoteRef`           | identity (`key → { key }`) | map each contract key to its path in the store                                                                 |
| `target`              | `name` only                | `creationPolicy` / `deletionPolicy` / `immutable`; `name` is always the secret name; `template` is not covered |

The options type is `ExternalSecretsBackendOptions<K>`; the CR types are
`ExternalSecret`, `ExternalSecretSpec`, `ExternalSecretDataEntry`,
`ExternalSecretRemoteRef`, `ExternalSecretTarget`,
`ExternalSecretCreationPolicy`, `ExternalSecretDeletionPolicy`,
`SecretStoreRef` and `SecretStoreKind`.

## Internals

Backends are declared with `Backend.define` (or `Backend.encrypting` for the
render-time encrypt pipeline) from `@konfig.ts/k8s`; this one declares `requiresSource: false`, so no plaintext
source is needed at render time.

## Requirements

konfig.ts is built on [Effect](https://effect.website/) 4. Any 4.x build from 4.1.0 on
is supported:

- **`effect@^4.1.0`** — peer dependency of every package.
- **`@effect/platform-node@^4.1.0`** — a regular dependency of `@konfig.ts/core`,
  since `renderAllYaml()` and `renderAllYamlEffect()` need its Node filesystem/subprocess
  implementations. It is installed automatically with core.
