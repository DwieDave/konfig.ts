import * as YAML from "yaml"
import { unsafeCoerce } from "./_cast"

const IGNORED_LABEL_KEYS = new Set(["helm.sh/chart"])
const IGNORED_ANNOTATION_KEYS = new Set([
  "meta.helm.sh/release-name",
  "meta.helm.sh/release-namespace"
])
const MANAGED_BY_HELM_LABEL = "app.kubernetes.io/managed-by"

const _redactLabelMap = (labels: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(labels)) {
    if (IGNORED_LABEL_KEYS.has(k)) continue
    if (k === MANAGED_BY_HELM_LABEL && v === "Helm") continue
    out[k] = v
  }
  return out
}

const _redactAnnotationMap = (annotations: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(annotations)) {
    if (IGNORED_ANNOTATION_KEYS.has(k)) continue
    out[k] = v
  }
  return out
}
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

// Drops null/undefined object keys deliberately: an explicit `field: null` then compares
// equal to an absent field, so "set to null" vs "removed" is intentionally invisible here.
export const redact = (input: RedactInput): unknown => {
  const value = input.value
  const parentKey = input.parentKey ?? null
  const options = input.options ?? {}
  if (Array.isArray(value)) {
    return value.map((v) => redact({ value: v, parentKey: null, options }))
  }
  if (value !== null && typeof value === "object") {
    const obj = unsafeCoerce<Record<string, unknown>>(
      value,
      "typeof === object && !Array.isArray && !== null narrowed above"
    )
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) continue
      if (k === "labels" && parentKey === "metadata" && v !== null && typeof v === "object") {
        out[k] = _redactLabelMap(unsafeCoerce(v, "metadata.labels is Record<string, string>"))
        continue
      }
      if (k === "annotations" && parentKey === "metadata" && v !== null && typeof v === "object") {
        out[k] = _redactAnnotationMap(unsafeCoerce(v, "metadata.annotations is Record<string, string>"))
        continue
      }
      if ((k === "data" || k === "stringData") && obj.kind === "Secret" && v !== null && typeof v === "object") {
        out[k] = _redactSecretDataMap(unsafeCoerce(v, "Secret data/stringData is a map of key -> value"))
        continue
      }
      out[k] = redact({ value: v, parentKey: k, options })
    }
    return out
  }
  if (options.normalizeNumerics === true) {
    if (typeof value === "string" && _isNumericString(value)) {
      return Number(value)
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value
    }
  }
  return value
}

export interface DeepEqualInput {
  readonly a: unknown
  readonly b: unknown
}
export const deepEqual = (input: DeepEqualInput): boolean => {
  const { a, b } = input
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual({ a: a[i], b: b[i] })) return false
    }
    return true
  }
  if (typeof a === "object" && typeof b === "object") {
    if (Array.isArray(b)) return false
    const oa = unsafeCoerce<Record<string, unknown>>(a, "typeof === object branch")
    const ob = unsafeCoerce<Record<string, unknown>>(b, "typeof === object branch")
    const ka = Object.keys(oa)
    if (ka.length !== Object.keys(ob).length) return false
    for (const k of ka) {
      if (!Object.hasOwn(ob, k)) return false
      if (!deepEqual({ a: oa[k], b: ob[k] })) return false
    }
    return true
  }
  return false
}

// Equality of two raw values as if both had been passed through `redact` first, without
// allocating the redacted copies. Must stay in lockstep with `redact`; the property test
// in diff.property.test.ts checks it against `deepEqual(redact(a), redact(b))`.
const _isPresent = (v: unknown): boolean => v !== null && v !== undefined

const _isObjectLike = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object"

const _labelKept = (k: string, v: unknown): boolean =>
  !IGNORED_LABEL_KEYS.has(k) && !(k === MANAGED_BY_HELM_LABEL && v === "Helm")

const _annotationKept = (k: string): boolean => !IGNORED_ANNOTATION_KEYS.has(k)

// Mirrors deepEqual(_redactLabelMap(a), _redactLabelMap(b)) / the annotation variant.
const _filteredMapEqual = (
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  keep: (k: string, v: unknown) => boolean
): boolean => {
  let countA = 0
  for (const [k, v] of Object.entries(a)) {
    if (!keep(k, v)) continue
    countA++
    if (!Object.hasOwn(b, k)) return false
    const bv = b[k]
    if (!keep(k, bv)) return false
    if (!deepEqual({ a: v, b: bv })) return false
  }
  let countB = 0
  for (const [k, v] of Object.entries(b)) if (keep(k, v)) countB++
  return countA === countB
}

// Mirrors deepEqual(_redactSecretDataMap(a), _redactSecretDataMap(b)): same key set.
const _sameKeySet = (a: Record<string, unknown>, b: Record<string, unknown>): boolean => {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) if (!Object.hasOwn(b, k)) return false
  return true
}

const _redactedLeafEqual = (a: unknown, b: unknown, options: RedactOptions): boolean => {
  if (options.normalizeNumerics === true) {
    const na = typeof a === "string" && _isNumericString(a) ? Number(a) : a
    const nb = typeof b === "string" && _isNumericString(b) ? Number(b) : b
    return deepEqual({ a: na, b: nb })
  }
  return deepEqual({ a, b })
}

const _redactedEqual = (a: unknown, b: unknown, parentKey: string | null, options: RedactOptions): boolean => {
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!_redactedEqual(a[i], b[i], null, options)) return false
    }
    return true
  }
  if (Array.isArray(b)) return false
  if (_isObjectLike(a)) {
    if (!_isObjectLike(b)) return false
    const aSecret = a.kind === "Secret"
    const bSecret = b.kind === "Secret"
    // Differing Secret-ness implies differing `kind` values, which is a difference on its own.
    if (aSecret !== bSecret) return false
    let countA = 0
    for (const [k, v] of Object.entries(a)) {
      if (!_isPresent(v)) continue
      countA++
      if (!Object.hasOwn(b, k)) return false
      const bv = b[k]
      if (!_isPresent(bv)) return false
      if (k === "labels" && parentKey === "metadata" && _isObjectLike(v)) {
        if (!_isObjectLike(bv) || !_filteredMapEqual(v, bv, _labelKept)) return false
        continue
      }
      if (k === "annotations" && parentKey === "metadata" && _isObjectLike(v)) {
        if (!_isObjectLike(bv) || !_filteredMapEqual(v, bv, _annotationKept)) return false
        continue
      }
      if ((k === "data" || k === "stringData") && aSecret && _isObjectLike(v)) {
        if (!_isObjectLike(bv) || !_sameKeySet(v, bv)) return false
        continue
      }
      if (!_redactedEqual(v, bv, k, options)) return false
    }
    let countB = 0
    for (const v of Object.values(b)) if (_isPresent(v)) countB++
    return countA === countB
  }
  if (_isObjectLike(b)) return false
  return _redactedLeafEqual(a, b, options)
}

export interface RedactedEqualInput {
  readonly a: unknown
  readonly b: unknown
  readonly options?: RedactOptions
}
/** Equivalent to `deepEqual({ a: redact({ value: a, options }), b: redact({ value: b, options }) })` without cloning. */
export const redactedEqual = (input: RedactedEqualInput): boolean =>
  _redactedEqual(input.a, input.b, null, input.options ?? {})

export const parseYaml = (text: string): unknown => YAML.parse(text)

// Drops empty/whitespace-only segments; positions of remaining docs are not preserved.
export const parseYamlAll = (text: string): ReadonlyArray<unknown> => {
  const docs = YAML.parseAllDocuments(text)
  const out: unknown[] = []
  for (const d of docs) {
    const value = d.toJS()
    if (value === null || value === undefined) continue
    out.push(value)
  }
  return out
}

// Keys by (kind, name, namespace) so docs diff by identity, not position.
const _docKey = (value: unknown, fallbackIdx: number): string => {
  if (value === null || typeof value !== "object") return `:doc:${fallbackIdx}`
  const v = unsafeCoerce<
    { readonly kind?: unknown; readonly metadata?: { readonly name?: unknown; readonly namespace?: unknown } }
  >(
    value,
    "typeof === object && !== null branch above narrowed value; every field access below is guarded by a typeof check"
  )
  const kind = typeof v.kind === "string" ? v.kind : ""
  const name = typeof v.metadata?.name === "string" ? v.metadata.name : ""
  const ns = typeof v.metadata?.namespace === "string" ? v.metadata.namespace : ""
  if (kind || name) return `${kind}|${ns}|${name}`
  return `:doc:${fallbackIdx}`
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

const _diffOne = (
  file: string,
  leftText: string,
  rightText: string,
  options: RedactOptions
): FileDiff => {
  // Docs are compared raw under redaction semantics; `redact` only runs once the file is
  // known to differ, so a Same file never clones its documents.
  const lDocs = parseYamlAll(leftText).map((v, i) => [_docKey(v, i), v] as const)
  const rDocs = parseYamlAll(rightText).map((v, i) => [_docKey(v, i), v] as const)
  const equal = (a: unknown, b: unknown): boolean => _redactedEqual(a, b, null, options)
  const clean = (value: unknown): unknown => redact({ value, options })

  if (lDocs.length <= 1 && rDocs.length <= 1) {
    const l = lDocs[0]?.[1]
    const r = rDocs[0]?.[1]
    if (equal(l, r)) return { _tag: "Same", file }
    return { _tag: "Changed", file, left: clean(l), right: clean(r) }
  }

  const lByKey = new Map(lDocs)
  const rByKey = new Map(rDocs)
  const keys = Array.from(new Set([...lByKey.keys(), ...rByKey.keys()])).sort()

  const docs: DocDiff[] = []
  let anyChange = false
  for (const key of keys) {
    const l = lByKey.get(key)
    const r = rByKey.get(key)
    if (l === undefined) {
      docs.push({ _tag: "MissingLeft", key, right: clean(r) })
      anyChange = true
    } else if (r === undefined) {
      docs.push({ _tag: "MissingRight", key, left: clean(l) })
      anyChange = true
    } else if (equal(l, r)) {
      docs.push({ _tag: "Same", key })
    } else {
      docs.push({ _tag: "Changed", key, left: clean(l), right: clean(r) })
      anyChange = true
    }
  }

  if (!anyChange) return { _tag: "Same", file }
  return {
    _tag: "Changed",
    file,
    left: lDocs.map((d) => clean(d[1])),
    right: rDocs.map((d) => clean(d[1])),
    docs
  }
}

export const diffFiles = (input: DiffFilesInput): DiffResult => {
  const { left, right } = input
  const options = input.options ?? {}
  const files = Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort()
  const entries: FileDiff[] = []
  for (const file of files) {
    const hasL = Object.hasOwn(left, file)
    const hasR = Object.hasOwn(right, file)
    if (!hasL) {
      entries.push({ _tag: "MissingLeft", file })
      continue
    }
    if (!hasR) {
      entries.push({ _tag: "MissingRight", file })
      continue
    }
    entries.push(_diffOne(file, left[file] ?? "", right[file] ?? "", options))
  }
  return { entries }
}

export const hasDifferences = (result: DiffResult): boolean => result.entries.some((e) => e._tag !== "Same")

export type DiffFormat = "summary" | "detail" | "json"

export interface FormatDiffInput {
  readonly result: DiffResult
  readonly format?: DiffFormat
}
export const formatDiff = (input: FormatDiffInput): string => {
  const { result } = input
  const format = input.format ?? "summary"
  if (format === "json") {
    return JSON.stringify(result, null, 2)
  }
  const changes = result.entries.filter((e) => e._tag !== "Same")
  if (changes.length === 0) return ""
  const lines: string[] = []
  for (const e of changes) {
    if (e._tag === "MissingLeft") lines.push(`+ ${e.file}`)
    else if (e._tag === "MissingRight") lines.push(`- ${e.file}`)
    else lines.push(`~ ${e.file}`)
    if (format === "detail" && e._tag === "Changed") {
      if (e.docs && e.docs.length > 0) {
        for (const d of e.docs) {
          if (d._tag === "Same") continue
          lines.push(`  [doc ${d.key}] ${d._tag}`)
          if (d._tag === "Changed") {
            lines.push("    left:")
            lines.push(
              ...YAML.stringify(d.left, { lineWidth: 0 })
                .split("\n")
                .map((l) => `      ${l}`)
            )
            lines.push("    right:")
            lines.push(
              ...YAML.stringify(d.right, { lineWidth: 0 })
                .split("\n")
                .map((l) => `      ${l}`)
            )
          }
        }
      } else {
        lines.push("  left:")
        lines.push(
          ...YAML.stringify(e.left, { lineWidth: 0 })
            .split("\n")
            .map((l) => `    ${l}`)
        )
        lines.push("  right:")
        lines.push(
          ...YAML.stringify(e.right, { lineWidth: 0 })
            .split("\n")
            .map((l) => `    ${l}`)
        )
      }
    }
  }
  return lines.join("\n")
}
