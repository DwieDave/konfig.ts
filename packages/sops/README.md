# @konfig.ts/sops

[sops](https://github.com/getsops/sops) integration. Wears two hats:

- **`Sops.source({file, keys, extract?})`** — a `SecretSource` that
  decrypts a sops-encrypted file at konfig-build time and yields the
  values as `Redacted<string>`. Compose with any backend
  (e.g. `SealedSecrets.backend`) to keep plaintext off disk while
  keeping the encrypted file as the source of truth in git.
- **`Sops.backend({recipients})`** — emits a `SopsSecret` CR
  (`isindir/sops-secrets-operator`-compatible). konfig re-encrypts the
  payload with the supplied recipients at render time.
- **`Sops.passthrough({file})`** — emits a `SopsSecret` whose body is
  the existing encrypted file verbatim. No decrypt + re-encrypt cycle.

Host-tool requirement: `sops` CLI on the konfig host. KMS / age
credentials are whatever the file's `sops:` block declares.

## Three compose-cases

| Case | Source | Backend | Notes |
|---|---|---|---|
| A | `Sops.source({...})` | `SealedSecrets.backend({...})` | git holds a sops file; cluster receives a SealedSecret. Two layers of encryption guard different surfaces. |
| B | any (e.g. `SecretSource.fromConfig`) | `Sops.backend({recipients})` | konfig encrypts to the in-cluster sops-secrets-operator's recipients. |
| C | none | `Sops.passthrough({file})` | encrypted file already shaped like a SopsSecret body; konfig only renders the CR shell. |

## Status

Phase 3c of the secret refactor — see `.docs/secret-refactoring/plan.md`.
