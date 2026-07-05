import { Redacted } from "effect"
import { createHash, type Hash } from "node:crypto"

export interface HashSecretValuesInput {
  readonly values: Readonly<Record<string, Redacted.Redacted<string>>>
  /**
   * Non-secret salt folded into the digest so it is NOT a pure function of the
   * plaintext — this defeats offline brute-force / rainbow-table recovery of
   * low-entropy secrets from the annotation. Use a stable per-workload
   * identifier such as `"<namespace>/<name>"`.
   */
  readonly salt: string
}

// Netstring-frames every field (`<byteLen>:<bytes>,`) before hashing. Plain
// `key + "=" + value + "\n"` concatenation is ambiguous — `{ "a=b": "c" }` and
// `{ "a": "b\nc" }` would hash identically. Length-prefixing makes each field
// boundary unforgeable, so distinct records always produce distinct digests.
const _frame = (hasher: Hash, value: string): void => {
  const bytes = Buffer.from(value, "utf8")
  hasher.update(`${bytes.length}:`)
  hasher.update(bytes)
  hasher.update(",")
}

// Captures values AT BUILD TIME ONLY — rotations between builds need an
// in-cluster watcher (e.g. Reloader). Redacted.value is inline so plaintext
// is not bound to a local.
//
// NOTE: the returned digest is a change-detection fingerprint, NOT a
// cryptographic commitment you may safely publish for a low-entropy secret.
// It is salted (so it is not a bare sha256 of the plaintext) and emitted at
// full width (no truncation), but it must not be treated as secret-safe.
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
