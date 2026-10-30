import * as YAML from "yaml"
import { isRecord } from "./guards"

const IGNORED_LABEL_KEYS = new Set(["helm.sh/chart"])
const IGNORED_ANNOTATION_KEYS = new Set([
  "meta.helm.sh/release-name",
  "meta.helm.sh/release-namespace"
])
const MANAGED_BY_HELM_LABEL = "app.kubernetes.io/managed-by"

const _labelKept = (k: string, v: unknown): boolean =>
  !IGNORED_LABEL_KEYS.has(k) && !(k === MANAGED_BY_HELM_LABEL && v === "Helm")

const _annotationKept = (k: string): boolean => !IGNORED_ANNOTATION_KEYS.has(k)

const _filterMap = (
  map: Record<string, unknown>,
  keep: (k: string, v: unknown) => boolean
): Record<string, unknown> => Object.fromEntries(Object.entries(map).filter(([k, v]) => keep(k, v)))

const _redactLabelMap = (labels: Record<string, unknown>): Record<string, unknown> => _filterMap(labels, _labelKept)

const _redactAnnotationMap = (annotations: Record<string, unknown>): Record<string, unknown> =>
  _filterMap(annotations, _annotationKept)
const _redactSecretDataMap = (data: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(data)) out[k] = "<redacted>"
  return out
}

export interface RedactOptions {
  // Normalize numeric strings only ("1.0" == 1); "true" stays a string.
  readonly normalizeNumerics?: boolean
}

const _isNumericString = (s: string): boolean => /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(s)

export interface RedactInput {
  readonly value: unknown
  readonly parentKey?: string | null
  readonly options?: RedactOptions
}

const _isPresent = (v: unknown): boolean => v !== null && v !== undefined

interface RedactEntryInput {
  readonly parent: Record<string, unknown>
  readonly key: string
  readonly value: unknown
  readonly parentKey: string | null
  readonly options: RedactOptions
}

const _redactEntry = (input: RedactEntryInput): unknown => {
  const { key, options, parent, parentKey, value } = input
  if (key === "labels" && parentKey === "metadata" && isRecord(value)) return _redactLabelMap(value)
  if (key === "annotations" && parentKey === "metadata" && isRecord(value)) return _redactAnnotationMap(value)
  if ((key === "data" || key === "stringData") && parent.kind === "Secret" && isRecord(value)) {
    return _redactSecretDataMap(value)
  }
  return redact({ value, parentKey: key, options })
}

const _redactRecord = (
  input: {
    readonly parent: Record<string, unknown>
    readonly parentKey: string | null
    readonly options: RedactOptions
  }
) =>
  Object.fromEntries(
    Object.entries(input.parent)
      .filter(([, v]) => _isPresent(v))
      .map(([key, value]) => [key, _redactEntry({ ...input, key, value })])
  )

const _redactLeaf = (input: { readonly value: unknown; readonly options: RedactOptions }): unknown =>
  input.options.normalizeNumerics === true && typeof input.value === "string" && _isNumericString(input.value)
    ? Number(input.value)
    : input.value

// Drops null/undefined object keys deliberately: an explicit `field: null` then compares
// equal to an absent field, so "set to null" vs "removed" is intentionally invisible here.
export const redact = (input: RedactInput): unknown => {
  const { value } = input
  const options = input.options ?? {}
  if (Array.isArray(value)) return value.map((v) => redact({ value: v, parentKey: null, options }))
  if (isRecord(value)) return _redactRecord({ parent: value, parentKey: input.parentKey ?? null, options })
  return _redactLeaf({ value, options })
}

export interface DeepEqualInput {
  readonly a: unknown
  readonly b: unknown
}
const _arrayDeepEqual = (a: ReadonlyArray<unknown>, b: unknown): boolean =>
  Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual({ a: x, b: b[i] }))

const _recordDeepEqual = (a: Record<string, unknown>, b: Record<string, unknown>): boolean => {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length &&
    keys.every((k) => Object.hasOwn(b, k) && deepEqual({ a: a[k], b: b[k] }))
}

export const deepEqual = (input: DeepEqualInput): boolean => {
  const { a, b } = input
  if (a === b) return true
  if (a === null || b === null || typeof a !== typeof b) return false
  if (Array.isArray(a)) return _arrayDeepEqual(a, b)
  return isRecord(a) && isRecord(b) && _recordDeepEqual(a, b)
}

interface FilteredMapInput {
  readonly a: Record<string, unknown>
  readonly b: Record<string, unknown>
  readonly keep: (k: string, v: unknown) => boolean
}

// Mirrors deepEqual(_redactLabelMap(a), _redactLabelMap(b)) / the annotation variant.
const _filteredMapEqual = (input: FilteredMapInput): boolean => {
  const { a, b, keep } = input
  const kept = Object.entries(a).filter(([k, v]) => keep(k, v))
  const sameEntries = kept.every(([k, v]) => Object.hasOwn(b, k) && keep(k, b[k]) && deepEqual({ a: v, b: b[k] }))
  return sameEntries && kept.length === Object.entries(b).filter(([k, v]) => keep(k, v)).length
}

// Mirrors deepEqual(_redactSecretDataMap(a), _redactSecretDataMap(b)): same key set.
const _sameKeySet = (a: Record<string, unknown>, b: Record<string, unknown>): boolean => {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k))
}

const _normalizeNumeric = (v: unknown): unknown => typeof v === "string" && _isNumericString(v) ? Number(v) : v

const _redactedLeafEqual = (input: { readonly a: unknown; readonly b: unknown; readonly options: RedactOptions }) =>
  input.options.normalizeNumerics === true
    ? deepEqual({ a: _normalizeNumeric(input.a), b: _normalizeNumeric(input.b) })
    : deepEqual({ a: input.a, b: input.b })

interface EqualInput {
  readonly a: unknown
  readonly b: unknown
  readonly parentKey: string | null
  readonly options: RedactOptions
}

interface FieldEqualInput {
  readonly key: string
  readonly a: unknown
  readonly b: unknown
  readonly parentKey: string | null
  readonly secret: boolean
  readonly options: RedactOptions
}

const _fieldEqual = (input: FieldEqualInput): boolean => {
  const { a, b, key, options, parentKey, secret } = input
  if (key === "labels" && parentKey === "metadata" && isRecord(a)) {
    return isRecord(b) && _filteredMapEqual({ a, b, keep: _labelKept })
  }
  if (key === "annotations" && parentKey === "metadata" && isRecord(a)) {
    return isRecord(b) && _filteredMapEqual({ a, b, keep: _annotationKept })
  }
  if ((key === "data" || key === "stringData") && secret && isRecord(a)) {
    return isRecord(b) && _sameKeySet(a, b)
  }
  return _redactedEqual({ a, b, parentKey: key, options })
}

const _recordRedactedEqual = (
  input: { readonly a: Record<string, unknown>; readonly b: Record<string, unknown> } & Omit<EqualInput, "a" | "b">
): boolean => {
  const { a, b, options, parentKey } = input
  const secret = a.kind === "Secret"
  if (secret !== (b.kind === "Secret")) return false
  const present = Object.entries(a).filter(([, v]) => _isPresent(v))
  const sameFields = present.every(([key, v]) =>
    Object.hasOwn(b, key) && _isPresent(b[key]) &&
    _fieldEqual({ key, a: v, b: b[key], parentKey, secret, options })
  )
  return sameFields && present.length === Object.values(b).filter(_isPresent).length
}

const _redactedEqual = (input: EqualInput): boolean => {
  const { a, b, options } = input
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length &&
      a.every((x, i) => _redactedEqual({ a: x, b: b[i], parentKey: null, options }))
  }
  if (Array.isArray(b)) return false
  if (isRecord(a)) return isRecord(b) && _recordRedactedEqual({ ...input, a, b })
  if (isRecord(b)) return false
  return _redactedLeafEqual({ a, b, options })
}

export interface RedactedEqualInput {
  readonly a: unknown
  readonly b: unknown
  readonly options?: RedactOptions
}
/** Equivalent to `deepEqual({ a: redact({ value: a, options }), b: redact({ value: b, options }) })` without cloning. */
export const redactedEqual = (input: RedactedEqualInput): boolean =>
  _redactedEqual({ a: input.a, b: input.b, parentKey: null, options: input.options ?? {} })

export const parseYaml = (text: string): unknown => YAML.parse(text)

// Drops empty/whitespace-only segments; positions of remaining docs are not preserved.
export const parseYamlAll = (text: string): ReadonlyArray<unknown> =>
  YAML.parseAllDocuments(text).map((d) => d.toJS()).filter(_isPresent)

// Keys by (kind, name, namespace) so docs diff by identity, not position.
const _docKey = (value: unknown, fallbackIdx: number): string => {
  if (!isRecord(value)) return `:doc:${fallbackIdx}`
  const kind = typeof value["kind"] === "string" ? value["kind"] : ""
  const metadata = isRecord(value["metadata"]) ? value["metadata"] : undefined
  const name = typeof metadata?.["name"] === "string" ? metadata["name"] : ""
  const ns = typeof metadata?.["namespace"] === "string" ? metadata["namespace"] : ""
  if (kind || name) return `${kind}|${ns}|${name}`
  return `:doc:${fallbackIdx}`
}

// Two docs in one file may share an identity; a Map would keep only the last and
// hide a change in the earlier one. Repeats get an occurrence suffix so each
// is compared against the same-numbered doc on the other side.
const _keyedDocs = (docs: ReadonlyArray<unknown>): ReadonlyArray<readonly [string, unknown]> => {
  const seen = new Map<string, number>()
  return docs.map((v, i) => {
    const base = _docKey(v, i)
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return [n === 1 ? base : `${base}#${n}`, v] as const
  })
}

export type DocDiff =
  | { readonly _tag: "Same"; readonly key: string }
  | { readonly _tag: "MissingLeft"; readonly key: string; readonly right: unknown }
  | { readonly _tag: "MissingRight"; readonly key: string; readonly left: unknown }
  | {
    readonly _tag: "Changed"
    readonly key: string
    readonly left: unknown
    readonly right: unknown
  }

export type FileDiff =
  | { readonly _tag: "Same"; readonly file: string }
  | { readonly _tag: "MissingLeft"; readonly file: string }
  | { readonly _tag: "MissingRight"; readonly file: string }
  | {
    readonly _tag: "Changed"
    readonly file: string
    readonly left: unknown
    readonly right: unknown
    readonly docs?: ReadonlyArray<DocDiff>
  }

export interface DiffResult {
  readonly entries: ReadonlyArray<FileDiff>
}

export interface DiffFilesInput {
  readonly left: Readonly<Record<string, string>>
  readonly right: Readonly<Record<string, string>>
  readonly options?: RedactOptions
}

interface DiffOneInput {
  readonly file: string
  readonly leftText: string
  readonly rightText: string
  readonly options: RedactOptions
}

type KeyedDocs = ReadonlyArray<readonly [string, unknown]>

interface DocsInput {
  readonly file: string
  readonly lDocs: KeyedDocs
  readonly rDocs: KeyedDocs
  readonly options: RedactOptions
}

const _diffSingle = (input: DocsInput): FileDiff => {
  const { file, options } = input
  const l = input.lDocs[0]?.[1]
  const r = input.rDocs[0]?.[1]
  if (_redactedEqual({ a: l, b: r, parentKey: null, options })) return { _tag: "Same", file }
  return { _tag: "Changed", file, left: redact({ value: l, options }), right: redact({ value: r, options }) }
}

const _diffDoc = (
  input: { readonly key: string; readonly l: unknown; readonly r: unknown; readonly options: RedactOptions }
): DocDiff => {
  const { key, l, options, r } = input
  const clean = (value: unknown): unknown => redact({ value, options })
  if (l === undefined) return { _tag: "MissingLeft", key, right: clean(r) }
  if (r === undefined) return { _tag: "MissingRight", key, left: clean(l) }
  if (_redactedEqual({ a: l, b: r, parentKey: null, options })) return { _tag: "Same", key }
  return { _tag: "Changed", key, left: clean(l), right: clean(r) }
}

const _diffMulti = (input: DocsInput): FileDiff => {
  const { file, lDocs, options, rDocs } = input
  const lByKey = new Map(lDocs)
  const rByKey = new Map(rDocs)
  const keys = Array.from(new Set([...lByKey.keys(), ...rByKey.keys()])).sort()
  const docs = keys.map((key) => _diffDoc({ key, l: lByKey.get(key), r: rByKey.get(key), options }))
  if (docs.every((d) => d._tag === "Same")) return { _tag: "Same", file }
  const clean = (d: readonly [string, unknown]): unknown => redact({ value: d[1], options })
  return { _tag: "Changed", file, left: lDocs.map(clean), right: rDocs.map(clean), docs }
}

// Docs are compared raw under redaction semantics; `redact` only runs once the file is
// known to differ, so a Same file never clones its documents.
const _diffOne = (input: DiffOneInput): FileDiff => {
  const docs: DocsInput = {
    file: input.file,
    lDocs: _keyedDocs(parseYamlAll(input.leftText)),
    rDocs: _keyedDocs(parseYamlAll(input.rightText)),
    options: input.options
  }
  return docs.lDocs.length <= 1 && docs.rDocs.length <= 1 ? _diffSingle(docs) : _diffMulti(docs)
}

const _diffFile = (
  input: {
    readonly file: string
    readonly left: Readonly<Record<string, string>>
    readonly right: Readonly<Record<string, string>>
    readonly options: RedactOptions
  }
): FileDiff => {
  const { file, left, options, right } = input
  if (!Object.hasOwn(left, file)) return { _tag: "MissingLeft", file }
  if (!Object.hasOwn(right, file)) return { _tag: "MissingRight", file }
  return _diffOne({ file, leftText: left[file] ?? "", rightText: right[file] ?? "", options })
}

export const diffFiles = (input: DiffFilesInput): DiffResult => {
  const { left, right } = input
  const options = input.options ?? {}
  const files = Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort()
  return { entries: files.map((file) => _diffFile({ file, left, right, options })) }
}

export const hasDifferences = (result: DiffResult): boolean => result.entries.some((e) => e._tag !== "Same")

export type DiffFormat = "summary" | "detail" | "json"

export interface FormatDiffInput {
  readonly result: DiffResult
  readonly format?: DiffFormat
}
const _indentYaml = (input: { readonly value: unknown; readonly pad: string }): string[] =>
  YAML.stringify(input.value, { lineWidth: 0 })
    .split("\n")
    .map((l) => `${input.pad}${l}`)

const _yamlBlock = (input: { readonly label: string; readonly value: unknown; readonly indent: string }): string[] => [
  `${input.indent}${input.label}:`,
  ..._indentYaml({ value: input.value, pad: `${input.indent}  ` })
]

const _sides = (input: { readonly left: unknown; readonly right: unknown; readonly indent: string }): string[] => [
  ..._yamlBlock({ label: "left", value: input.left, indent: input.indent }),
  ..._yamlBlock({ label: "right", value: input.right, indent: input.indent })
]

const _docLines = (d: DocDiff): string[] => {
  if (d._tag === "Same") return []
  const head = `  [doc ${d.key}] ${d._tag}`
  return d._tag === "Changed" ? [head, ..._sides({ left: d.left, right: d.right, indent: "    " })] : [head]
}

const _detailLines = (e: Extract<FileDiff, { readonly _tag: "Changed" }>): string[] =>
  e.docs && e.docs.length > 0
    ? e.docs.flatMap(_docLines)
    : _sides({ left: e.left, right: e.right, indent: "  " })

const _FILE_MARK = { MissingLeft: "+", MissingRight: "-", Same: "~", Changed: "~" } as const

const _entryLines = (input: { readonly entry: FileDiff; readonly format: DiffFormat }): string[] => {
  const { entry, format } = input
  const head = `${_FILE_MARK[entry._tag]} ${entry.file}`
  return format === "detail" && entry._tag === "Changed" ? [head, ..._detailLines(entry)] : [head]
}

export const formatDiff = (input: FormatDiffInput): string => {
  const { result } = input
  const format = input.format ?? "summary"
  if (format === "json") return JSON.stringify(result, null, 2)
  return result.entries
    .filter((entry) => entry._tag !== "Same")
    .flatMap((entry) => _entryLines({ entry, format }))
    .join("\n")
}
