import { Data, Effect, Predicate } from "effect"
import * as YAML from "yaml"
import { isRecord } from "./guards"
import { YamlParseError } from "./RenderError"

export type Json =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<Json>
  | { readonly [key: string]: Json }

type JsonRecord = { readonly [key: string]: Json }

const _isArray = (v: Json): v is ReadonlyArray<Json> => Array.isArray(v)

const _text = (v: Json): string => Predicate.isString(v) ? v : ""

const IGNORED_LABEL_KEYS = new Set(["helm.sh/chart"])

const IGNORED_ANNOTATION_KEYS = new Set([
  "meta.helm.sh/release-name",
  "meta.helm.sh/release-namespace"
])

const MANAGED_BY_HELM_LABEL = "app.kubernetes.io/managed-by"

interface _Entry {
  readonly key: string
  readonly value: Json
}

type _Keep = (entry: _Entry) => boolean

const _labelKept: _Keep = ({ key, value }) =>
  !IGNORED_LABEL_KEYS.has(key) && !(key === MANAGED_BY_HELM_LABEL && value === "Helm")

const _annotationKept: _Keep = ({ key }) => !IGNORED_ANNOTATION_KEYS.has(key)

const _filterMap = (input: { readonly map: JsonRecord; readonly keep: _Keep }): JsonRecord =>
  Object.fromEntries(Object.entries(input.map).filter(([key, value]) => input.keep({ key, value })))

const _redactLabelMap = (labels: JsonRecord): JsonRecord => _filterMap({ map: labels, keep: _labelKept })

const _redactAnnotationMap = (annotations: JsonRecord): JsonRecord =>
  _filterMap({ map: annotations, keep: _annotationKept })

const _redactSecretDataMap = (data: JsonRecord): JsonRecord =>
  Object.fromEntries(Object.keys(data).map((k) => [k, "<redacted>"]))

type _Rule = Data.TaggedEnum<{
  Labels: {}
  Annotations: {}
  SecretData: {}
  Recurse: {}
}>

const _Rule = Data.taggedEnum<_Rule>()

const _ruleFor = (
  input: { readonly key: string; readonly parentKey: string | null; readonly secret: boolean }
): _Rule => {
  const { key, parentKey, secret } = input

  if (key === "labels" && parentKey === "metadata") return _Rule.Labels()

  if (key === "annotations" && parentKey === "metadata") return _Rule.Annotations()

  if ((key === "data" || key === "stringData") && secret) return _Rule.SecretData()

  return _Rule.Recurse()
}

export interface RedactOptions {
  // Normalize numeric strings only ("1.0" == 1); "true" stays a string.
  readonly normalizeNumerics?: boolean
}

const _isNumericString = (s: string): boolean => /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(s)

const _normalizeNumeric = (v: Json): Json => Predicate.isString(v) && _isNumericString(v) ? Number(v) : v

const _leaf = (input: { readonly value: Json; readonly options: RedactOptions }): Json =>
  input.options.normalizeNumerics === true ? _normalizeNumeric(input.value) : input.value

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
  const recurse = () => redact({ value, parentKey: key, options })

  if (!isRecord(value)) return recurse()

  return _Rule.$match(_ruleFor({ key, parentKey, secret: parent.kind === "Secret" }), {
    Labels: () => _redactLabelMap(value),
    Annotations: () => _redactAnnotationMap(value),
    SecretData: () => _redactSecretDataMap(value),
    Recurse: recurse
  })
}

const _redactRecord = (
  input: { readonly parent: JsonRecord; readonly parentKey: string | null; readonly options: RedactOptions }
) =>
  Object.fromEntries(
    Object.entries(input.parent)
      .filter(([, v]) => _isPresent(v))
      .map(([key, value]) => [key, _redactEntry({ ...input, key, value })])
  )

// Drops null/undefined object keys deliberately: an explicit `field: null` then compares
// equal to an absent field, so "set to null" vs "removed" is intentionally invisible here.
export const redact = (input: RedactInput): Json => {
  const { value } = input
  const options = input.options ?? {}

  if (_isArray(value)) return value.map((v) => redact({ value: v, parentKey: null, options }))

  if (isRecord(value)) return _redactRecord({ parent: value, parentKey: input.parentKey ?? null, options })

  return _leaf({ value, options })
}

export interface DeepEqualInput {
  readonly a: Json
  readonly b: Json
}

const _arrayDeepEqual = (input: { readonly a: ReadonlyArray<Json>; readonly b: Json }): boolean => {
  const { a, b } = input

  return _isArray(b) && a.length === b.length && a.every((x, i) => deepEqual({ a: x, b: b[i] }))
}

const _recordDeepEqual = (input: { readonly a: JsonRecord; readonly b: JsonRecord }): boolean => {
  const { a, b } = input
  const keys = Object.keys(a)

  return keys.length === Object.keys(b).length &&
    keys.every((k) => Object.hasOwn(b, k) && deepEqual({ a: a[k], b: b[k] }))
}

export const deepEqual = (input: DeepEqualInput): boolean => {
  const { a, b } = input

  if (a === b) return true

  if (_isArray(a)) return _arrayDeepEqual({ a, b })

  return isRecord(a) && isRecord(b) && _recordDeepEqual({ a, b })
}

interface FilteredMapInput {
  readonly a: JsonRecord
  readonly b: JsonRecord
  readonly keep: _Keep
}

// Mirrors deepEqual(_redactLabelMap(a), _redactLabelMap(b)) / the annotation variant.
const _filteredMapEqual = (input: FilteredMapInput): boolean => {
  const { a, b, keep } = input
  const kept = Object.entries(a).filter(([key, value]) => keep({ key, value }))

  const sameEntries = kept.every(([key, value]) =>
    Object.hasOwn(b, key) && keep({ key, value: b[key] }) && deepEqual({ a: value, b: b[key] })
  )

  return sameEntries && kept.length === Object.entries(b).filter(([key, value]) => keep({ key, value })).length
}

// Mirrors deepEqual(_redactSecretDataMap(a), _redactSecretDataMap(b)): same key set.
const _sameKeySet = (input: { readonly a: JsonRecord; readonly b: JsonRecord }): boolean => {
  const { a, b } = input
  const ka = Object.keys(a)

  return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k))
}

interface EqualInput {
  readonly a: Json
  readonly b: Json
  readonly parentKey: string | null
  readonly options: RedactOptions
}

interface FieldEqualInput extends EqualInput {
  readonly key: string
  readonly secret: boolean
}

const _fieldEqual = (input: FieldEqualInput): boolean => {
  const { a, b, key, options, parentKey, secret } = input
  const recurse = () => _redactedEqual({ a, b, parentKey: key, options })

  if (!isRecord(a)) return recurse()

  return _Rule.$match(_ruleFor({ key, parentKey, secret }), {
    Labels: () => isRecord(b) && _filteredMapEqual({ a, b, keep: _labelKept }),
    Annotations: () => isRecord(b) && _filteredMapEqual({ a, b, keep: _annotationKept }),
    SecretData: () => isRecord(b) && _sameKeySet({ a, b }),
    Recurse: recurse
  })
}

const _recordRedactedEqual = (
  input: {
    readonly a: JsonRecord
    readonly b: JsonRecord
    readonly parentKey: string | null
    readonly options: RedactOptions
  }
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

  if (isRecord(a)) return isRecord(b) && _recordRedactedEqual({ ...input, a, b })

  if (isRecord(b)) return false

  return deepEqual({ a: _leaf({ value: a, options }), b: _leaf({ value: b, options }) })
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

const _parseDocuments = (text: string): Effect.Effect<ReadonlyArray<Json>, YamlParseError> =>
  Effect.suspend(() => {
    const docs = YAML.parseAllDocuments(text, { uniqueKeys: true })
    const reasons = docs.flatMap((d) => d.errors.map((e) => e.message))

    return reasons.length > 0
      ? Effect.fail(new YamlParseError({ reasons }))
      : Effect.try({
        try: () => docs.map((d): Json => d.toJS()),
        catch: (cause) => new YamlParseError({ reasons: [String(cause)] })
      })
  })

// Drops empty/whitespace-only segments; positions of remaining docs are not preserved.
// Fails on any syntax error or duplicate mapping key instead of yielding a partial value.
export const parseYamlAll = (text: string): Effect.Effect<ReadonlyArray<Json>, YamlParseError> =>
  Effect.map(_parseDocuments(text), (docs) => docs.filter(_isPresent))

// Keys by (kind, name, namespace) so docs diff by identity, not position.
const _docKey = (input: { readonly value: Json; readonly fallbackIdx: number }): string => {
  const { fallbackIdx, value } = input

  if (!isRecord(value)) return `:doc:${fallbackIdx}`
  const metadata = value["metadata"]
  const meta: JsonRecord = isRecord(metadata) ? metadata : {}
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
    const base = _docKey({ value: v, fallbackIdx: i })
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

const _absentSideDocs = (input: { readonly left: Json; readonly right: Json }): ReadonlyArray<DocDiff> | undefined => {
  const { left, right } = input

  if (left === undefined) return [DocDiff.MissingLeft({ key: ":doc:0", right })]

  return right === undefined ? [DocDiff.MissingRight({ key: ":doc:0", left })] : undefined
}

const _diffSingle = (input: DocsInput): FileDiff => {
  const { file, options } = input
  const l = input.lDocs[0]?.[1]
  const r = input.rDocs[0]?.[1]

  if (_redactedEqual({ a: l, b: r, parentKey: null, options })) return FileDiff.Same({ file })

  const left = redact({ value: l, options })
  const right = redact({ value: r, options })

  return FileDiff.Changed({ file, left, right, docs: _absentSideDocs({ left, right }) })
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
const _diffOne = (input: DiffOneInput): Effect.Effect<FileDiff, YamlParseError> =>
  Effect.gen(function*() {
    const [left, right] = yield* Effect.all([parseYamlAll(input.leftText), parseYamlAll(input.rightText)])
    const { file, options } = input
    const docs: DocsInput = { file, lDocs: _keyedDocs(left), rDocs: _keyedDocs(right), options }

    return docs.lDocs.length <= 1 && docs.rDocs.length <= 1 ? _diffSingle(docs) : _diffMulti(docs)
  })

const _diffFile = (
  input: {
    readonly file: string
    readonly left: Readonly<Record<string, string>>
    readonly right: Readonly<Record<string, string>>
    readonly options: RedactOptions
  }
): Effect.Effect<FileDiff, YamlParseError> => {
  const { file, left, options, right } = input

  if (!Object.hasOwn(left, file)) return Effect.succeed(FileDiff.MissingLeft({ file }))

  if (!Object.hasOwn(right, file)) return Effect.succeed(FileDiff.MissingRight({ file }))

  return _diffOne({ file, leftText: left[file] ?? "", rightText: right[file] ?? "", options })
}

export const diffFiles = (input: DiffFilesInput): Effect.Effect<DiffResult, YamlParseError> => {
  const { left, right } = input
  const options = input.options ?? {}
  const files = Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort()

  return Effect.forEach(files, (file) => _diffFile({ file, left, right, options })).pipe(
    Effect.map((entries) => ({ entries }))
  )
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
