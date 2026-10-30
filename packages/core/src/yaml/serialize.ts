import { Predicate, Schema } from "effect"
import * as YAML from "yaml"
import { isRecord } from "../guards"
import type { YamlRecord } from "./record"

const ORDER_ROOT = ["apiVersion", "kind", "metadata", "spec", "status"]
const ORDER_METADATA = ["name", "namespace", "labels", "annotations"]

type _Out =
  | string
  | number
  | boolean
  | bigint
  | Date
  | null
  | undefined
  | YAML.Scalar
  | ReadonlyArray<_Out>
  | _OutMap

interface _OutMap {
  readonly [key: string]: _Out
}

interface _ReorderInput {
  readonly obj: YamlRecord
  readonly depth: number
  readonly parentKey: string | null
}

interface _OrderInput {
  readonly depth: number
  readonly parentKey: string | null
}

const _orderFor = ({ depth, parentKey }: _OrderInput): ReadonlyArray<string> | null =>
  depth === 0 ? ORDER_ROOT : depth === 1 && parentKey === "metadata" ? ORDER_METADATA : null

interface _SortInput {
  readonly keys: ReadonlyArray<string>
  readonly order: ReadonlyArray<string> | null
}

const _sortedKeys = ({ keys, order }: _SortInput): ReadonlyArray<string> =>
  order === null
    ? [...keys].sort()
    : [...order.filter((k) => keys.includes(k)), ...keys.filter((k) => !order.includes(k)).sort()]

const _reorderObject = ({ obj, depth, parentKey }: _ReorderInput): _OutMap => {
  const keys = Object.keys(obj).filter((k) => obj[k] !== null && obj[k] !== undefined)
  const sorted = _sortedKeys({ keys, order: _orderFor({ depth, parentKey }) })

  return Object.fromEntries(
    sorted.map((k) => [k, _normalize({ value: obj[k], depth: depth + 1, parentKey: k })])
  )
}

interface _NormalizeInput {
  readonly value: unknown
  readonly depth: number
  readonly parentKey: string | null
}

const _isString = Schema.is(Schema.String)

const _isLeaf = Predicate.or(
  Predicate.or(Predicate.isNumber, Predicate.isBoolean),
  Predicate.or(Predicate.isBigInt, Predicate.isDate)
)

const _normalize = (input: _NormalizeInput): _Out => {
  const { value, depth, parentKey } = input

  if (value === null || value === undefined) return value

  if (Array.isArray(value)) {
    return value.map((v) => _normalize({ value: v, depth: depth + 1, parentKey: null }))
  }

  if (_isString(value)) return _safeString(value)

  if (Predicate.isDate(value)) return _safeString(value.toISOString())

  if (_isLeaf(value)) return value

  if (value instanceof Map) return _normalize({ value: _mapToRecord(value), depth, parentKey })

  if (value instanceof Set) return _normalize({ value: [...value], depth, parentKey })

  return isRecord(value) && _hasPlainPrototype(value) ? _reorderObject({ obj: value, depth, parentKey }) : undefined
}

const _hasPlainPrototype = (value: YamlRecord): boolean =>
  [Object.prototype, null].includes(Object.getPrototypeOf(value))

const _mapToRecord = (map: ReadonlyMap<string, _Out>): YamlRecord =>
  Object.fromEntries([...map].filter(([k]) => _isString(k)))

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

const _isNonEmpty = Schema.is(Schema.NonEmptyString)

// Caller invariant: kind and metadata.name must be non-empty strings (validate/decode first).
// Throws synchronously as a defect — deliberately not routed through AnyRenderError.
export const filenameFor = (resource: {
  readonly kind?: unknown
  readonly metadata?: { readonly name?: unknown }
}): string => {
  const kind = resource.kind
  const name = resource.metadata?.name

  if (!_isNonEmpty(kind)) {
    throw new Error(`filenameFor: resource has no string kind`)
  }

  if (!_isNonEmpty(name)) {
    throw new Error(`filenameFor: resource '${kind}' has no metadata.name`)
  }

  return `${_sanitizeNameForFilename(kind)}-${_sanitizeNameForFilename(name)}.yaml`
}

const _sanitizeNameForFilename = (name: string): string => name.replace(/[./]/g, "-")
