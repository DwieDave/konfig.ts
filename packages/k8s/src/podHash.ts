import { Redacted } from "effect"
import { createHash, type Hash } from "node:crypto"

export interface HashSecretValuesInput {
  readonly values: Readonly<Record<string, Redacted.Redacted<string>>>
  // Non-secret; folded into the digest so it isn't a pure function of the plaintext (defeats rainbow-table recovery).
  readonly salt: string
}

// Netstring-frames each field (len:bytes,) so distinct records can't collide (unlike plain "key=value\n" concatenation).
const _frame = (hasher: Hash, value: string): void => {
  const bytes = Buffer.from(value, "utf8")
  hasher.update(`${bytes.length}:`)
  hasher.update(bytes)
  hasher.update(",")
}

// Captures values at build time only; rotations between builds need an in-cluster watcher (e.g. Reloader).
// This digest is a change-detection fingerprint, not a safe-to-publish cryptographic commitment.
export const hashSecretValues = (input: HashSecretValuesInput): string => {
  const hasher = createHash("sha256")
  _frame(hasher, "konfig/secret-values-hash/v1")
  _frame(hasher, input.salt)
  const keys = Object.keys(input.values).sort()
  for (const key of keys) {
    _frame(hasher, key)
    _frame(hasher, Redacted.value(input.values[key]!))
  }
  return hasher.digest("hex")
}
