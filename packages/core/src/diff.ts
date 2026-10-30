import { Data, Predicate } from "effect"
import * as YAML from "yaml"

export type Json =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<Json>
  | { readonly [key: string]: Json }

type JsonRecord = { readonly [key: string]: Json }

const _isRecord = (v: Json): v is JsonRecord => Predicate.isObject(v)

const _isArray = (v: Json): v is ReadonlyArray<Json> => Array.isArray(v)

const _text = (v: Json): string => Predicate.isString(v) ? v : ""

const IGNORED_LABEL_KEYS = new Set(["helm.sh/chart"])

const IGNORED_ANNOTATION_KEYS = new Set([
  "meta.helm.sh/release-name",
  "meta.helm.sh/release-namespace"
])

const MANAGED_BY_HELM_LABEL = "app.kubernetes.io/managed-by"

const _labelKept = (k: string, v: Json): boolean =>
  !IGNORED_LABEL_KEYS.has(k) && !(k === MANAGED_BY_HELM_LABEL && v === "Helm")

const _annotationKept = (k: string): boolean => !IGNORED_ANNOTATION_KEYS.has(k)

const _filterMap = (
  map: JsonRecord,
  keep: (k: string, v: Json) => boolean
): JsonRecord => Object.fromEntries(Object.entries(map).filter(([k, v]) => keep(k, v)))

const _redactLabelMap = (labels: JsonRecord): JsonRecord => _filterMap(labels, _labelKept)

const _redactAnnotationMap = (annotations: JsonRecord): JsonRecord => _filterMap(annotations, _annotationKept)

const _redactSecretDataMap = (data: JsonRecord): JsonRecord =>
  Object.fromEntries(Object.keys(data).map((k) => [k, "<redacted>"]))

export interface RedactOptions {
  // Normalize numeric strings only ("1.0" == 1); "true" stays a string.
  readonly normalizeNumerics?: boolean
}

const _isNumericString = (s: string): boolean => /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(s)

export interface RedactInput {
  readonly value: Json
  readonly parentKey?: string | null
  readonly options?: RedactOptions
}

const _isPresent = (v: Json): boolean => v !== null && v !== undefined

interface RedactEntryInput {
  readonly parent: JsonRecord
  readonly key: string
  readonly value: Json
  readonly parentKey: string | null
  readonly options: RedactOptions
}

const _redactEntry = (input: RedactEntryInput): Json => {
  const { key, options, parent, parentKey, value } = input

  if (key === "labels" && parentKey === "metadata" && _isRecord(value)) return _redactLabelMap(value)

  if (key === "annotations" && parentKey === "metadata" && _isRecord(value)) return _redactAnnotationMap(value)

  if ((key === "data" || key === "stringData") && parent.kind === "Secret" && _isRecord(value)) {
    return _redactSecretDataMap(value)
  }

  return redact({ value, parentKey: key, options })
}

const _redactRecord = (
  input: {
    readonly parent: JsonRecord
    readonly parentKey: string | null
    readonly options: RedactOptions
  }
) =>
  Object.fromEntries(
    Object.entries(input.parent)
      .filter(([, v]) => _isPresent(v))
      .map(([key, value]) => [key, _redactEntry({ ...input, key, value })])
  )

const _redactLeaf = (input: { readonly value: Json; readonly options: RedactOptions }): Json =>
  input.options.normalizeNumerics === true && Predicate.isString(input.value) && _isNumericString(input.value)
    ? Number(input.value)
    : input.value

// Drops null/undefined object keys deliberately: an explicit `field: null` then compares
// equal to an absent field, so "set to null" vs "removed" is intentionally invisible here.
export const redact = (input: RedactInput): Json => {
  const { value } = input
  const options = input.options ?? {}

  if (_isArray(value)) return value.map((v) => redact({ value: v, parentKey: null, options }))

  if (_isRecord(value)) return _redactRecord({ parent: value, parentKey: input.parentKey ?? null, options })

  return _redactLeaf({ value, options })
}

export interface DeepEqualInput {
  readonly a: Json
  readonly b: Json
}

const _arrayDeepEqual = (a: ReadonlyArray<Json>, b: Json): boolean =>
  _isArray(b) && a.length === b.length && a.every((x, i) => deepEqual({ a: x, b: b[i] }))

const _recordDeepEqual = (a: JsonRecord, b: JsonRecord): boolean => {
  const keys = Object.keys(a)

  return keys.length === Object.keys(b).length &&
    keys.every((k) => Object.hasOwn(b, k) && deepEqual({ a: a[k], b: b[k] }))
}

export const deepEqual = (input: DeepEqualInput): boolean => {
  const { a, b } = input

  if (a === b) return true

  if (_isArray(a)) return _arrayDeepEqual(a, b)

  return _isRecord(a) && _isRecord(b) && _recordDeepEqual(a, b)
}

interface FilteredMapInput {
  readonly a: JsonRecord
  readonly b: JsonRecord
  readonly keep: (k: string, v: Json) => boolean
}

// Mirrors deepEqual(_redactLabelMap(a), _redactLabelMap(b)) / the annotation variant.
const _filteredMapEqual = (input: FilteredMapInput): boolean => {
  const { a, b, keep } = input
  const kept = Object.entries(a).filter(([k, v]) => keep(k, v))
  const sameEntries = kept.every(([k, v]) => Object.hasOwn(b, k) && keep(k, b[k]) && deepEqual({ a: v, b: b[k] }))

  return sameEntries && kept.length === Object.entries(b).filter(([k, v]) => keep(k, v)).length
}

// Mirrors deepEqual(_redactSecretDataMap(a), _redactSecretDataMap(b)): same key set.
const _sameKeySet = (a: JsonRecord, b: JsonRecord): boolean => {
  const ka = Object.keys(a)

  return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k))
}

const _normalizeNumeric = (v: Json): Json => Predicate.isString(v) && _isNumericString(v) ? Number(v) : v

const _redactedLeafEqual = (input: { readonly a: Json; readonly b: Json; readonly options: RedactOptions }) =>
  input.options.normalizeNumerics === true
    ? deepEqual({ a: _normalizeNumeric(input.a), b: _normalizeNumeric(input.b) })
    : deepEqual({ a: input.a, b: input.b })

interface EqualInput {
  readonly a: Json
  readonly b: Json
  readonly parentKey: string | null
  readonly options: RedactOptions
}

interface FieldEqualInput {
  readonly key: string
  readonly a: Json
  readonly b: Json
  readonly parentKey: string | null
  readonly secret: boolean
  readonly options: RedactOptions
}

const _fieldEqual = (input: FieldEqualInput): boolean => {
  const { a, b, key, options, parentKey, secret } = input

  if (key === "labels" && parentKey === "metadata" && _isRecord(a)) {
    return _isRecord(b) && _filteredMapEqual({ a, b, keep: _labelKept })
  }

  if (key === "annotations" && parentKey === "metadata" && _isRecord(a)) {
    return _isRecord(b) && _filteredMapEqual({ a, b, keep: _annotationKept })
  }

  if ((key === "data" || key === "stringData") && secret && _isRecord(a)) {
    return _isRecord(b) && _sameKeySet(a, b)
  }

  return _redactedEqual({ a, b, parentKey: key, options })
}

const _recordRedactedEqual = (
  input: { readonly a: JsonRecord; readonly b: JsonRecord } & Omit<EqualInput, "a" | "b">
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

  if (_isArray(a)) {
    return _isArray(b) && a.length === b.length &&
      a.every((x, i) => _redactedEqual({ a: x, b: b[i], parentKey: null, options }))
  }

  if (_isArray(b)) return false

  if (_isRecord(a)) return _isRecord(b) && _recordRedactedEqual({ ...input, a, b })

  if (_isRecord(b)) return false

  return _redactedLeafEqual({ a, b, options })
}

export interface RedactedEqualInput {
  readonly a: Json
  readonly b: Json
  readonly options?: RedactOptions
}

/** Equivalent to `deepEqual({ a: redact({ value: a, options }), b: redact({ value: b, options }) })` without cloning. */
export const redactedEqual = (input: RedactedEqualInput): boolean =>
  _redactedEqual({ a: input.a, b: input.b, parentKey: null, options: input.options ?? {} })

export const parseYaml = (text: string): Json => YAML.parse(text)

// Drops empty/whitespace-only segments; positions of remaining docs are not preserved.
export const parseYamlAll = (text: string): ReadonlyArray<Json> =>
  YAML.parseAllDocuments(text).map((d) => d.toJS()).filter(_isPresent)

// Keys by (kind, name, namespace) so docs diff by identity, not position.
const _docKey = (value: Json, fallbackIdx: number): string => {
  if (!_isRecord(value)) return `:doc:${fallbackIdx}`
  const metadata = value["metadata"]
  const meta: JsonRecord = _isRecord(metadata) ? metadata : {}
  const kind = _text(value["kind"])
  const name = _text(meta["name"])
  const ns = _text(meta["namespace"])

  if (kind || name) return `${kind}|${ns}|${name}`

  return `:doc:${fallbackIdx}`
}

// Two docs in one file may share an identity; a Map would keep only the last and
// hide a change in the earlier one. Repeats get an occurrence suffix so each
// is compared against the same-numbered doc on the other side.
const _keyedDocs = (docs: ReadonlyArray<Json>): ReadonlyArray<readonly [string, Json]> => {
  const seen = new Map<string, number>()

  return docs.map((v, i) => {
    const base = _docKey(v, i)
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)

    return [n === 1 ? base : `${base}#${n}`, v] as const
  })
}

export type DocDiff = Data.TaggedEnum<{
  Same: { readonly key: string }
  MissingLeft: { readonly key: string; readonly right: Json }
  MissingRight: { readonly key: string; readonly left: Json }
  Changed: { readonly key: string; readonly left: Json; readonly right: Json }
}>

export type FileDiff = Data.TaggedEnum<{
  Same: { readonly file: string }
  MissingLeft: { readonly file: string }
  MissingRight: { readonly file: string }
  Changed: {
    readonly file: string
    readonly left: Json
    readonly right: Json
    readonly docs?: ReadonlyArray<DocDiff>
  }
}>

const DocDiff = Data.taggedEnum<DocDiff>()
const FileDiff = Data.taggedEnum<FileDiff>()

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

type KeyedDocs = ReadonlyArray<readonly [string, Json]>

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

  if (_redactedEqual({ a: l, b: r, parentKey: null, options })) return FileDiff.Same({ file })

  return FileDiff.Changed({ file, left: redact({ value: l, options }), right: redact({ value: r, options }) })
}

const _diffDoc = (
  input: { readonly key: string; readonly l: Json; readonly r: Json; readonly options: RedactOptions }
): DocDiff => {
  const { key, l, options, r } = input
  const clean = (value: Json): Json => redact({ value, options })

  if (l === undefined) return DocDiff.MissingLeft({ key, right: clean(r) })

  if (r === undefined) return DocDiff.MissingRight({ key, left: clean(l) })

  if (_redactedEqual({ a: l, b: r, parentKey: null, options })) return DocDiff.Same({ key })

  return DocDiff.Changed({ key, left: clean(l), right: clean(r) })
}

const _diffMulti = (input: DocsInput): FileDiff => {
  const { file, lDocs, options, rDocs } = input
  const lByKey = new Map(lDocs)
  const rByKey = new Map(rDocs)
  const keys = Array.from(new Set([...lByKey.keys(), ...rByKey.keys()])).sort()
  const docs = keys.map((key) => _diffDoc({ key, l: lByKey.get(key), r: rByKey.get(key), options }))

  if (docs.every(DocDiff.$is("Same"))) return FileDiff.Same({ file })
  const clean = (d: readonly [string, Json]): Json => redact({ value: d[1], options })

  return FileDiff.Changed({ file, left: lDocs.map(clean), right: rDocs.map(clean), docs })
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

  if (!Object.hasOwn(left, file)) return FileDiff.MissingLeft({ file })

  if (!Object.hasOwn(right, file)) return FileDiff.MissingRight({ file })

  return _diffOne({ file, leftText: left[file] ?? "", rightText: right[file] ?? "", options })
}

export const diffFiles = (input: DiffFilesInput): DiffResult => {
  const { left, right } = input
  const options = input.options ?? {}
  const files = Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort()

  return { entries: files.map((file) => _diffFile({ file, left, right, options })) }
}

export const hasDifferences = (result: DiffResult): boolean => result.entries.some((e) => !FileDiff.$is("Same")(e))

export type DiffFormat = "summary" | "detail" | "json"

export interface FormatDiffInput {
  readonly result: DiffResult
  readonly format?: DiffFormat
}

const _indentYaml = (input: { readonly value: Json; readonly pad: string }): string[] =>
  YAML.stringify(input.value, { lineWidth: 0 })
    .split("\n")
    .map((l) => `${input.pad}${l}`)

const _yamlBlock = (input: { readonly label: string; readonly value: Json; readonly indent: string }): string[] => [
  `${input.indent}${input.label}:`,
  ..._indentYaml({ value: input.value, pad: `${input.indent}  ` })
]

const _sides = (input: { readonly left: Json; readonly right: Json; readonly indent: string }): string[] => [
  ..._yamlBlock({ label: "left", value: input.left, indent: input.indent }),
  ..._yamlBlock({ label: "right", value: input.right, indent: input.indent })
]

const _docLines = (d: DocDiff): string[] => {
  const head = `  [doc ${d.key}] ${d._tag}`

  return DocDiff.$match(d, {
    Same: () => [],
    MissingLeft: () => [head],
    MissingRight: () => [head],
    Changed: ({ left, right }) => [head, ..._sides({ left, right, indent: "    " })]
  })
}

const _detailLines = (e: Data.TaggedEnum.Value<FileDiff, "Changed">): string[] =>
  e.docs && e.docs.length > 0
    ? e.docs.flatMap(_docLines)
    : _sides({ left: e.left, right: e.right, indent: "  " })

const _FILE_MARK = { MissingLeft: "+", MissingRight: "-", Same: "~", Changed: "~" } as const

const _entryLines = (input: { readonly entry: FileDiff; readonly format: DiffFormat }): string[] => {
  const { entry, format } = input
  const head = `${_FILE_MARK[entry._tag]} ${entry.file}`

  return format === "detail" && FileDiff.$is("Changed")(entry) ? [head, ..._detailLines(entry)] : [head]
}

export const formatDiff = (input: FormatDiffInput): string => {
  const { result } = input
  const format = input.format ?? "summary"

  if (format === "json") return JSON.stringify(result, null, 2)

  return result.entries
    .filter((entry) => !FileDiff.$is("Same")(entry))
    .flatMap((entry) => _entryLines({ entry, format }))
    .join("\n")
}
