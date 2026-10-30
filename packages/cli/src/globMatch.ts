interface Cursor {
  readonly pattern: string
  readonly index: number
}

interface Parsed {
  readonly source: string
  readonly index: number
}

const _SPECIAL = /[\\^$.|+(){}[\]*?]/

const _escape = (c: string): string => _SPECIAL.test(c) ? `\\${c}` : c

const _isBoundary = (c: string | undefined): boolean => c === undefined || c === "/" || c === "{" || c === ","

const _isEnd = (c: string | undefined): boolean => c === undefined || c === "}" || c === ","

const _parseStar = ({ index, pattern }: Cursor): Parsed => {
  if (pattern[index + 1] !== "*") return { source: "[^/]*", index: index + 1 }
  const atBoundary = _isBoundary(pattern[index - 1])
  const after = pattern[index + 2]
  if (atBoundary && after === "/") return { source: "(?:.*/)?", index: index + 3 }
  if (atBoundary && _isEnd(after)) return { source: ".*", index: index + 2 }
  return { source: "[^/]*", index: index + 2 }
}

const _parseClass = ({ index, pattern }: Cursor): Parsed => {
  const end = pattern.indexOf("]", index + 2)
  if (end === -1) return { source: "\\[", index: index + 1 }
  const body = pattern.slice(index + 1, end).replace(/^[!^]/, "^").replace(/\\/g, "\\\\")
  return { source: `[${body}]`, index: end + 1 }
}

const _parseSequence = (cursor: Cursor & { readonly inBrace: boolean }): Parsed => {
  const { inBrace, pattern } = cursor
  let source = ""
  let index = cursor.index
  while (index < pattern.length) {
    const c = pattern[index]
    if (inBrace && (c === "," || c === "}")) break
    const atom = _parseAtom({ pattern, index })
    source += atom.source
    index = atom.index
  }
  return { source, index }
}

const _parseBraces = ({ index, pattern }: Cursor): Parsed => {
  const alternatives: string[] = []
  let cursor = index + 1
  while (true) {
    const seq = _parseSequence({ pattern, index: cursor, inBrace: true })
    alternatives.push(seq.source)
    if (pattern[seq.index] === ",") {
      cursor = seq.index + 1
    } else if (pattern[seq.index] === "}") {
      return { source: `(?:${alternatives.join("|")})`, index: seq.index + 1 }
    } else {
      return { source: "\\{", index: index + 1 }
    }
  }
}

const _parseAtom = (cursor: Cursor): Parsed => {
  const { index, pattern } = cursor
  const c = pattern[index] ?? ""
  if (c === "*") return _parseStar(cursor)
  if (c === "?") return { source: "[^/]", index: index + 1 }
  if (c === "[") return _parseClass(cursor)
  if (c === "{") return _parseBraces(cursor)
  if (c === "\\" && index + 1 < pattern.length) {
    return { source: _escape(pattern[index + 1] ?? ""), index: index + 2 }
  }
  return { source: _escape(c), index: index + 1 }
}

const _globToRegExp = (pattern: string): RegExp =>
  new RegExp(`^${_parseSequence({ pattern, index: 0, inBrace: false }).source}$`)

export interface MatchesGlobInput {
  readonly pattern: string
  readonly path: string
}

export const matchesGlob = ({ path, pattern }: MatchesGlobInput): boolean => _globToRegExp(pattern).test(path)
