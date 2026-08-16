import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

/**
 * Snippets are read from `examples/full-stack` at build time. Anchors are text
 * matches, so a moved or edited example fails the build instead of drifting.
 */
const findRepoRoot = (from: string): string => {
  let dir = from
  for (;;) {
    if (existsSync(path.join(dir, "examples", "full-stack", "konfig.json"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error(`could not find repo root (examples/full-stack/konfig.json) above ${from}`)
    dir = parent
  }
}

export const EXAMPLE_ROOT = path.join(findRepoRoot(process.cwd()), "examples", "full-stack")

export interface DiagnosticAnchor {
  /** Substring of the line to underline; the first line containing `on` (or `find`) is used. */
  readonly find: string
  /** Optional line marker to disambiguate: the first line containing it. Defaults to `find`. */
  readonly on?: string
  readonly code: string
  /** Editor-style hover text (abridged from the real tsc output). */
  readonly message: string
}

export interface ResolvedDiagnostic {
  readonly line: number
  readonly colStart: number
  readonly colEnd: number
  readonly code: string
  readonly message: string
}

export interface SnippetSpec {
  readonly file: string
  /** 1-based inclusive line range, or `undefined` for the whole file. */
  readonly lines?: readonly [number, number]
  /** Cut lines from `startAfter` (exclusive, first match) to `endBefore` (exclusive, first match after). */
  readonly between?: { readonly startAfter?: string; readonly startAt?: string; readonly endBefore?: string }
  /** Drop `// @ts-expect-error …` and `// Demonstrates:` lines so the code reads like a real file. */
  readonly stripMeta?: boolean
  readonly diagnostics?: ReadonlyArray<DiagnosticAnchor>
}

export interface Snippet {
  readonly file: string
  readonly code: string
  readonly diagnostics: ReadonlyArray<ResolvedDiagnostic>
}

const META_LINE = /^\s*\/\/\s*(@ts-expect-error|Demonstrates:|probe)/
// `void _x` lines only exist to satisfy unused-variable lint in the examples.
const VOID_LINE = /^\s*void\s+_[a-zA-Z]\w*\s*$/

export const readExample = (file: string): string => readFileSync(path.join(EXAMPLE_ROOT, file), "utf8")

export const sliceSnippet = (raw: string, spec: SnippetSpec): string => {
  let lines = raw.replace(/\s+$/u, "").split("\n")
  if (spec.lines !== undefined) {
    lines = lines.slice(spec.lines[0] - 1, spec.lines[1])
  }
  if (spec.between !== undefined) {
    const startMarker = spec.between.startAt ?? spec.between.startAfter
    if (startMarker === undefined) throw new Error(`snippet ${spec.file}: between needs startAt or startAfter`)
    const startHit = lines.findIndex((l) => l.includes(startMarker))
    if (startHit < 0) throw new Error(`snippet ${spec.file}: start marker ${JSON.stringify(startMarker)} not found`)
    const start = spec.between.startAt === undefined ? startHit : startHit - 1
    const endBefore = spec.between.endBefore
    const end = endBefore === undefined ? lines.length : lines.findIndex((l, i) => i > start && l.includes(endBefore))
    if (end < 0) throw new Error(`snippet ${spec.file}: endBefore ${JSON.stringify(endBefore)} not found`)
    lines = lines.slice(start + 1, end)
  }
  if (spec.stripMeta === true) {
    lines = lines
      .filter((l) => !META_LINE.test(l) && !VOID_LINE.test(l))
      .map((l) => l.replace(/\b_(?=[a-zA-Z])/g, ""))
  }
  while (lines.length > 0 && lines[0]!.trim() === "") lines.shift()
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop()
  return dedent(lines).join("\n")
}

const dedent = (lines: ReadonlyArray<string>): ReadonlyArray<string> => {
  const indents = lines.filter((l) => l.trim() !== "").map((l) => l.match(/^\s*/)![0].length)
  const min = indents.length === 0 ? 0 : Math.min(...indents)
  return lines.map((l) => l.slice(min))
}

export const resolveDiagnostics = (
  code: string,
  anchors: ReadonlyArray<DiagnosticAnchor>,
  file: string
): ReadonlyArray<ResolvedDiagnostic> => {
  const lines = code.split("\n")
  return anchors.map((a) => {
    const marker = a.on ?? a.find
    const line = lines.findIndex((l) => l.includes(marker))
    if (line < 0) throw new Error(`diagnostic anchor ${JSON.stringify(marker)} not found in ${file}`)
    const colStart = lines[line]!.indexOf(a.find)
    if (colStart < 0) throw new Error(`diagnostic text ${JSON.stringify(a.find)} not on anchored line in ${file}`)
    return { line, colStart, colEnd: colStart + a.find.length, code: a.code, message: a.message }
  })
}

export const loadSnippet = (spec: SnippetSpec): Snippet => {
  const code = sliceSnippet(readExample(spec.file), spec)
  return { file: spec.file, code, diagnostics: resolveDiagnostics(code, spec.diagnostics ?? [], spec.file) }
}
