import type { DiffFormat } from "@konfig.ts/core"
import { Match } from "effect"

interface Edit {
  readonly op: "keep" | "add" | "remove"
  readonly text: string
}

interface LineChange {
  readonly op: "add" | "remove"
  readonly line: number
  readonly text: string
}

type LcsTable = ReadonlyArray<ReadonlyArray<number>>

interface LinesInput {
  readonly left: ReadonlyArray<string>
  readonly right: ReadonlyArray<string>
}

const _lcsRow = (
  { next, a, right }: {
    readonly next: ReadonlyArray<number>
    readonly a: string
    readonly right: ReadonlyArray<string>
  }
): ReadonlyArray<number> =>
  right.reduceRight<ReadonlyArray<number>>(
    (row, b, j) => [a === b ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[0] ?? 0)].concat(row),
    [0]
  )

const _lcsTable = ({ left, right }: LinesInput): LcsTable =>
  left.reduceRight<LcsTable>(
    (rows, a) => [_lcsRow({ next: rows[0] ?? [], a, right })].concat(rows),
    [right.map(() => 0).concat(0)]
  )

const _cell = ({ table, i, j }: { readonly table: LcsTable; readonly i: number; readonly j: number }): number =>
  table[i]?.[j] ?? 0

const _walk = (
  { input, table, i, j }: {
    readonly input: LinesInput
    readonly table: LcsTable
    readonly i: number
    readonly j: number
  }
): ReadonlyArray<Edit> => {
  const { left, right } = input
  const a = left[i]
  const b = right[j]

  if (a === undefined && b === undefined) return []

  if (a !== undefined && a === b) return [{ op: "keep", text: a }, ..._walk({ input, table, i: i + 1, j: j + 1 })]

  if (b !== undefined && (a === undefined || _cell({ table, i, j: j + 1 }) >= _cell({ table, i: i + 1, j }))) {
    return [{ op: "add", text: b }, ..._walk({ input, table, i, j: j + 1 })]
  }

  return [{ op: "remove", text: a ?? "" }, ..._walk({ input, table, i: i + 1, j })]
}

export const diffLines = (input: LinesInput): ReadonlyArray<Edit> =>
  _walk({ input, table: _lcsTable(input), i: 0, j: 0 })

interface Cursor {
  readonly l: number
  readonly r: number
  readonly changes: ReadonlyArray<LineChange>
}

const _step = ({ cur, e }: { readonly cur: Cursor; readonly e: Edit }): Cursor =>
  Match.value(e.op).pipe(
    Match.when("keep", () => ({ ...cur, l: cur.l + 1, r: cur.r + 1 })),
    Match.when("remove", () => ({
      ...cur,
      l: cur.l + 1,
      changes: cur.changes.concat({ op: "remove", line: cur.l, text: e.text })
    })),
    Match.when("add", () => ({
      ...cur,
      r: cur.r + 1,
      changes: cur.changes.concat({ op: "add", line: cur.r, text: e.text })
    })),
    Match.exhaustive
  )

export const changesOf = (edits: ReadonlyArray<Edit>): ReadonlyArray<LineChange> =>
  edits.reduce<Cursor>((cur, e) => _step({ cur, e }), { l: 1, r: 1, changes: [] }).changes

interface CountInput {
  readonly changes: ReadonlyArray<LineChange>
  readonly op: LineChange["op"]
}

const _count = ({ changes, op }: CountInput): number => changes.filter((c) => c.op === op).length

const _detailLine = (c: LineChange): string => `${c.op === "add" ? "+" : "-"} L${c.line}: ${c.text}`

interface RenderInput {
  readonly left: string
  readonly right: string
  readonly format: DiffFormat
}

export const renderDockerDiff = ({ format, left, right }: RenderInput): string => {
  const changes = changesOf(diffLines({ left: left.split("\n"), right: right.split("\n") }))

  return Match.value(format).pipe(
    Match.when("json", () => JSON.stringify({ changes })),
    Match.when("summary", () => `+${_count({ changes, op: "add" })} -${_count({ changes, op: "remove" })}`),
    Match.when("detail", () => changes.map(_detailLine).join("\n")),
    Match.exhaustive
  )
}
