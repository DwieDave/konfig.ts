# @konfig.ts/external-secrets

`ExternalSecret` CR backend for entries from `@konfig.ts/env`.

## What it does

Pairs with `Secret.bind` / `Environment.bind` from `@konfig.ts/k8s` to
emit `external-secrets.io/v1beta1` `ExternalSecret` manifests. The
in-cluster External Secrets Operator reconciles those into normal
`Secret` objects by pulling values from an external store
(AWS Secrets Manager, GCP SM, Vault, 1Password Connect, etc.).

Konfig itself never touches the values — `requiresSource: false`. The
secrets live entirely in the external store.

## Usage

```ts
import { defineSecret } from "@konfig.ts/env";
import { Secret } from "@konfig.ts/k8s";
import { ExternalSecrets } from "@konfig.ts/external-secrets";

const dbCreds = defineSecret({
  name: "db-creds",
  namespace: "prod",
  env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" },
});

const bound = Secret.bind({
  secret: dbCreds,
  backend: ExternalSecrets.backend({
    secretStoreRef: { name: "aws-prod", kind: "ClusterSecretStore" },
    refreshInterval: "1h",
    remoteRef: (key) => ({ key: `prod/api/${key}` }),
  }),
});

// bound.manifest renders an ExternalSecret CR.
// bound.envVars wires the container env via secretKeyRef.
```

## Options

| Field | Default | Notes |
|---|---|---|
| `secretStoreRef.name` | required | name of `SecretStore` / `ClusterSecretStore` |
| `secretStoreRef.kind` | `"SecretStore"` | switch to `"ClusterSecretStore"` for cluster-scoped stores |
| `refreshInterval` | omitted (ESO default) | e.g. `"1h"`, `"30m"` |
| `remoteRef` | identity (`key` → `{key}`) | map each key to its remote path |

## Status

Phase 3a of the secret refactor — see `.docs/secret-refactoring/plan.md`.
