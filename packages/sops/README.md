# @konfig.ts/sops

[SOPS](https://github.com/getsops/sops) secret backend for konfig.ts. Keep
encrypted secrets in git and turn them into cluster secrets at render time —
either by re-encrypting to your cluster's recipients, or by emitting an
already-encrypted `SopsSecret` for the in-cluster
[sops-secrets-operator](https://github.com/isindir/sops-secrets-operator) to
reconcile.

## Install

```bash
bun add @konfig.ts/sops
```

Needs the `sops` CLI on the machine that runs `konfig build`. KMS / age
credentials come from each file's own `sops:` metadata block.

## Usage

Bind a secret contract (`Secret.define`, from `@konfig.ts/env`) to a Sops
backend. `Sops` offers two modes — pick by how you want plaintext to flow.

```ts
import { SecretSource } from "@konfig.ts/env"
import { Secret } from "@konfig.ts/k8s"
import { Sops } from "@konfig.ts/sops"

// dbCreds = Secret.define({ name, namespace, env: { url, password } })

// passthrough — emit an already-encrypted SopsSecret verbatim (offline, no decrypt)
Secret.bind({
  secret: dbCreds,
  backend: Sops.passthrough({ file: "infra/secrets/SopsSecret-db-creds.yaml" })
})

// backend — re-encrypt the resolved values to the operator's recipients
Secret.bind({
  secret: dbCreds,
  backend: Sops.backend({ recipients: { age: ["age1..."] } }),
  source: SecretSource.fromConfig({ keys: ["url", "password"], envName: (k) => `DB_${k.toUpperCase()}` })
})
```

`Secret.bind(...)` returns a handle whose `.manifest` is the emitted CR. For a
whole env bundle, plug the same backend into
`Environment.bind({ env, namespace, secrets: { db: { backend, source? } } })`.

## Modes

| Mode               | Signature                                            | Source | Emits                                                              |
| ------------------ | ---------------------------------------------------- | ------ | ------------------------------------------------------------------ |
| `Sops.passthrough` | `({ file })`                                         | no     | the encrypted file's `SopsSecret`, restamped to the bound identity |
| `Sops.backend`     | `({ recipients, type?, encryptedRegex?, timeout? })` | yes    | a `SopsSecret` re-encrypted to `recipients`                        |

`recipients` accepts `age` / `kms` / `gcpKms` / `azureKv` / `pgp` arrays.
Every emitted value selected by the file's encryption rules is checked for the
`ENC[...]` marker first — konfig fails closed rather than emit plaintext
dressed as a secret.

`Sops.passthrough` accepts a file with exactly one `secretTemplates` entry that
contains every key of the bound contract. Bound labels, annotations and a
different name or namespace are merged into `metadata` only when the file was
encrypted with `mac_only_encrypted: true`; otherwise the render fails.

## Internals

Backends are declared with `Backend.define` (or `Backend.encrypting` for the
render-time encrypt pipeline) from `@konfig.ts/k8s`; `requiresSource: true` makes `source` a compile-time
requirement.

## Requirements

konfig.ts is built on [Effect](https://effect.website/) 4. Any 4.x build from 4.1.0 on
is supported:

- **`effect@^4.1.0`** — peer dependency of every package.
- **`@effect/platform-node@^4.1.0`** — a regular dependency of `@konfig.ts/core`,
  since `renderAllYaml()` and `renderAllYamlEffect()` need its Node filesystem/subprocess
  implementations. It is installed automatically with core.
