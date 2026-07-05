import * as YAML from "yaml"
import { unsafeCoerce } from "../_cast"

const ORDER_ROOT = ["apiVersion", "kind", "metadata", "spec", "status"]
const ORDER_METADATA = ["name", "namespace", "labels", "annotations"]

interface _ReorderInput {
  readonly obj: Record<string, unknown>
  readonly depth: number
  readonly parentKey: string | null
}
const _reorderObject = (input: _ReorderInput): Record<string, unknown> => {
  const { obj, depth, parentKey } = input
  const keys = Object.keys(obj).filter((k) => obj[k] !== null && obj[k] !== undefined)
  const order = depth === 0 ? ORDER_ROOT : depth === 1 && parentKey === "metadata" ? ORDER_METADATA : null

  let sortedKeys: string[]
  if (order !== null) {
    const known = order.filter((k) => keys.includes(k))
    const rest = keys.filter((k) => !order.includes(k)).sort()
    sortedKeys = [...known, ...rest]
  } else {
    sortedKeys = keys.slice().sort()
  }

  const out: Record<string, unknown> = {}
  for (const k of sortedKeys) {
    out[k] = _normalize({ value: obj[k], depth: depth + 1, parentKey: k })
  }
  return out
}

interface _NormalizeInput {
  readonly value: unknown
  readonly depth: number
  readonly parentKey: string | null
}
const _normalize = (input: _NormalizeInput): unknown => {
  const { value, depth, parentKey } = input
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) {
    return value.map((v) => _normalize({ value: v, depth: depth + 1, parentKey: null }))
  }
  if (typeof value === "object") {
    return _reorderObject({
      obj: unsafeCoerce<Record<string, unknown>>(
        value,
        "typeof === object branch (value !== null, !Array.isArray above) — treated as a keyed record for reordering"
      ),
      depth,
      parentKey
    })
  }
  return value
}

export interface SerializeInput {
  readonly value: unknown
  readonly trailingNewline?: boolean
}
export const serialize = (input: SerializeInput): string => {
  const normalized = _normalize({ value: input.value, depth: 0, parentKey: null })
  const raw = YAML.stringify(normalized, {
    indent: 2,
    indentSeq: true,
    lineWidth: 0,
    minContentWidth: 0,
    defaultStringType: "PLAIN",
    defaultKeyType: "PLAIN",
    nullStr: "null",
    // Emit YAML safe under 1.1 readers (kubectl/go-yaml). Forces plain strings
    // like "no"/"yes"/"on"/"off" to be quoted so they aren't coerced to bools.
    version: "1.1"
  })
  const lf = raw.replace(/\r\n/g, "\n").replace(/\s+$/g, "")
  return (input.trailingNewline ?? true) ? `${lf}\n` : lf
}

/**
 * Derive the on-disk filename (`<Kind>-<name>.yaml`) for a rendered
 * resource.
 *
 * **Precondition (caller invariant):** `resource.kind` and
 * `resource.metadata.name` MUST both be non-empty strings. A rendered
 * Kubernetes object always satisfies this, so callers are expected to
 * validate/decode the object *before* reaching this point (the CLI keys
 * files by kind+name only for objects it has already confirmed carry
 * both fields).
 *
 * Because the precondition is a caller invariant rather than runtime
 * input, a violation is a programming error: this throws synchronously
 * (a defect) instead of returning a typed error. It is deliberately kept
 * out of the `AnyRenderError` channel — do not route untrusted resources
 * through it; narrow them first.
 *
 * @throws {Error} if `kind` or `metadata.name` is missing or empty.
 */
export const filenameFor = (resource: {
  readonly kind?: unknown
  readonly metadata?: { readonly name?: unknown }
}): string => {
  const kind = resource.kind
  const name = resource.metadata?.name
  if (typeof kind !== "string" || kind.length === 0) {
    throw new Error(`filenameFor: resource has no string kind`)
  }
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`filenameFor: resource '${kind}' has no metadata.name`)
  }
  return `${kind}-${_sanitizeNameForFilename(name)}.yaml`
}

const _sanitizeNameForFilename = (name: string): string => name.replace(/[./]/g, "-")
