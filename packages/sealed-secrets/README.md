# @konfig.ts/sealed-secrets

[Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets) backend for
konfig.ts. Encrypts secret values with `kubeseal` at render time and emits a
`SealedSecret` CR that only the in-cluster controller can decrypt — so the
encrypted manifest is safe to commit to git.

## Install

```bash
bun add @konfig.ts/sealed-secrets
```

Needs the `kubeseal` CLI on the machine that runs `konfig build`, plus the
controller's public cert — resolved from `certPath`, else `$KUBESEAL_CERT`.
Missing cert fails fast with `KubesealCertMissing`.

## Usage

Bind a secret contract (`Secret.define`, from `@konfig.ts/env`) to the backend
and give it a `source` for the plaintext to seal:

```ts
import { SecretSource } from "@konfig.ts/env"
import { Secret } from "@konfig.ts/k8s"
import { SealedSecrets } from "@konfig.ts/sealed-secrets"

const dbCreds = Secret.define({
  name: "db-creds",
  namespace: "prod",
  env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" }
})

const bound = Secret.bind({
  secret: dbCreds,
  backend: SealedSecrets.backend({ scope: "strict" }),
  source: SecretSource.fromConfig({
    keys: ["url", "password"],
    envName: (k) => `DB_${k.toUpperCase()}`
  })
})
// bound.manifest is the SealedSecret CR.
```

At render time konfig resolves the source to plaintext (held only in
`Redacted<string>` in memory), builds a plain `Secret`, pipes it to `kubeseal`
over stdin, and emits the returned `SealedSecret`. The plaintext never lands on
disk.

## Options

| Field      | Default          | Notes                                                                                          |
| ---------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| `scope`    | `"strict"`       | `strict` = same name + namespace; `namespace-wide` = rename within ns; `cluster-wide` = any ns |
| `certPath` | `$KUBESEAL_CERT` | path to the sealed-secrets controller's public cert                                            |

## Internals

Backends implement the `SecretBackend<N, K, RequiresSource>` contract from
`@konfig.ts/k8s`; `requiresSource: true` makes `source` a compile-time
requirement. See the `Environment` section of
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
