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
    const ka = Object.keys(unsafeCoerce<object>(a, "typeof === object branch")).sort()
    const kb = Object.keys(unsafeCoerce<object>(b, "typeof === object branch")).sort()
    if (ka.length !== kb.length) return false
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return false
    for (const k of ka) {
      const av = unsafeCoerce<Record<string, unknown>>(a, "typeof === object branch")[k]
      const bv = unsafeCoerce<Record<string, unknown>>(b, "typeof === object branch")[k]
      if (!deepEqual({ a: av, b: bv })) return false
    }
    return true
  }
  return false
}

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
  const lDocs = parseYamlAll(leftText).map((v, i) => [_docKey(v, i), redact({ value: v, options })] as const)
  const rDocs = parseYamlAll(rightText).map((v, i) => [_docKey(v, i), redact({ value: v, options })] as const)

  if (lDocs.length <= 1 && rDocs.length <= 1) {
    const l = lDocs[0]?.[1]
    const r = rDocs[0]?.[1]
    if (deepEqual({ a: l, b: r })) return { _tag: "Same", file }
    return { _tag: "Changed", file, left: l, right: r }
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
      docs.push({ _tag: "MissingLeft", key, right: r })
      anyChange = true
    } else if (r === undefined) {
      docs.push({ _tag: "MissingRight", key, left: l })
      anyChange = true
    } else if (deepEqual({ a: l, b: r })) {
      docs.push({ _tag: "Same", key })
    } else {
      docs.push({ _tag: "Changed", key, left: l, right: r })
      anyChange = true
    }
  }

  if (!anyChange) return { _tag: "Same", file }
  return {
    _tag: "Changed",
    file,
    left: lDocs.map((d) => d[1]),
    right: rDocs.map((d) => d[1]),
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
