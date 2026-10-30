import * as YAML from "yaml"
import { isRecord } from "../guards"

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
  if (isRecord(value)) {
    return _reorderObject({ obj: value, depth, parentKey })
  }
  return typeof value === "string" ? _safeString(value) : value
}

// The yaml block-scalar writer drops a whitespace-only line, so such strings
// are emitted double-quoted where every character survives.
const _BLANK_LINE = /(^|\n)[ \t]+(\n|$)/
const _safeString = (value: string): string | YAML.Scalar => _BLANK_LINE.test(value) ? _quoted(value) : value

const _quoted = (value: string): YAML.Scalar => {
  const node = new YAML.Scalar(value)
  node.type = "QUOTE_DOUBLE"
  return node
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
  return _finish({ text: raw.replace(/\r\n/g, "\n"), trailingNewline: input.trailingNewline ?? true })
}

interface _FinishInput {
  readonly text: string
  readonly trailingNewline: boolean
}
// A keep-chomped block scalar (|+) ends in content newlines, so only the single
// document terminator may ever be removed; stripping more corrupts the value.
const _finish = ({ text, trailingNewline }: _FinishInput): string => {
  const terminated = text.endsWith("\n") ? text : `${text}\n`
  if (trailingNewline) return terminated
  return terminated.endsWith("\n\n") ? terminated : terminated.slice(0, -1)
}

// Caller invariant: kind and metadata.name must be non-empty strings (validate/decode first).
// Throws synchronously as a defect — deliberately not routed through AnyRenderError.
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
  return `${_sanitizeNameForFilename(kind)}-${_sanitizeNameForFilename(name)}.yaml`
}

const _sanitizeNameForFilename = (name: string): string => name.replace(/[./]/g, "-")
