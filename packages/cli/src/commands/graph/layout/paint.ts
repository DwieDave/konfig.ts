import { BUILD_TOKEN, type EdgeKind, type LaidNode } from "./types"

export interface Cell {
  readonly x: number
  readonly y: number
  readonly ch: string
}

const _crossings: ReadonlySet<string> = new Set(["│─", "─│", "╎─", "─╎"])
const _verticals: ReadonlySet<string> = new Set(["│╎", "╎│"])
const _precedence = ["▼", "▽", "┬", "┴"] as const

const mergeChars = (input: { readonly existing: string; readonly incoming: string }): string => {
  const { existing: a, incoming: b } = input
  if (a === " ") return b
  if (b === " " || a === b) return a
  const pair = `${a}${b}`
  if (_crossings.has(pair)) return "┼"
  if (_verticals.has(pair)) return "│"
  return _precedence.find((p) => a === p || b === p) ?? b
}

export class CharGrid {
  private readonly rows: string[][]
  public readonly width: number
  public readonly height: number

  constructor(input: { readonly width: number; readonly height: number }) {
    this.width = input.width
    this.height = input.height
    this.rows = Array.from({ length: input.height }, () => Array.from({ length: input.width }, () => " "))
  }

  put(cell: Cell): void {
    const row = this.rows[cell.y]
    if (!row || cell.x < 0 || cell.x >= this.width) return
    row[cell.x] = mergeChars({ existing: row[cell.x] ?? " ", incoming: cell.ch })
  }

  putAll(cells: ReadonlyArray<Cell>): void {
    for (const cell of cells) this.put(cell)
  }

  putString(input: { readonly x: number; readonly y: number; readonly text: string }): void {
    this.putAll(input.text.split("").map((ch, i) => ({ x: input.x + i, y: input.y, ch })))
  }

  toString(): string {
    return this.rows.map((r) => r.join("").replace(/\s+$/, "")).join("\n")
  }
}

const _edgeRow = (input: {
  readonly width: number
  readonly corners: readonly [string, string]
  readonly marks: ReadonlySet<number>
  readonly mark: string
}): string =>
  Array.from({ length: input.width }, (_unused, i) => {
    if (i === 0) return input.corners[0]
    if (i === input.width - 1) return input.corners[1]
    return input.marks.has(i) ? input.mark : "─"
  }).join("")

const _dummyBoxLine = (width: number): string => {
  const offset = Math.floor(width / 2)
  return `${" ".repeat(offset)}│${" ".repeat(Math.max(0, width - offset - 1))}`
}

const _labelRow = (input: { readonly left: string; readonly right: string; readonly innerWidth: number }): string =>
  `│ ${input.left}${" ".repeat(Math.max(0, input.innerWidth - input.left.length - input.right.length))}${input.right} │`

export const renderBoxLines = (input: {
  readonly laid: LaidNode
  readonly outgoingSlots: ReadonlyArray<number>
  readonly incomingSlots: ReadonlyArray<number>
}): [string, string, string, string] => {
  const { laid } = input
  const real = laid.data.real
  const width = laid.boxWidth
  if (real === null) {
    const line = _dummyBoxLine(width)
    return [line, line, line, line]
  }
  const relative = (xs: ReadonlyArray<number>): Set<number> => new Set(xs.map((x) => x - laid.boxStartX))
  const innerWidth = width - 4
  return [
    _edgeRow({ width, corners: ["┌", "┐"], marks: relative(input.incomingSlots), mark: "┴" }),
    _labelRow({ left: real.name, right: "", innerWidth }),
    _labelRow({ left: real.relDir, right: real.hasBuildScript ? BUILD_TOKEN : "", innerWidth }),
    _edgeRow({ width, corners: ["└", "┘"], marks: relative(input.outgoingSlots), mark: "┬" })
  ]
}

const _range = (input: { readonly from: number; readonly to: number }): number[] =>
  Array.from({ length: Math.max(0, input.to - input.from) }, (_unused, i) => input.from + i)

const _turnCells = (input: {
  readonly startX: number
  readonly endX: number
  readonly turnY: number
  readonly vert: string
}): Cell[] => {
  const { startX, endX, turnY, vert } = input
  if (startX === endX) return [{ x: startX, y: turnY, ch: vert }]
  const forward = startX < endX
  const lo = Math.min(startX, endX)
  const hi = Math.max(startX, endX)
  return [
    { x: startX, y: turnY, ch: forward ? "└" : "┘" },
    ..._range({ from: lo + 1, to: hi }).map((x) => ({ x, y: turnY, ch: "─" })),
    { x: endX, y: turnY, ch: forward ? "┐" : "┌" }
  ]
}

export const routeCells = (input: {
  readonly startX: number
  readonly endX: number
  readonly startY: number
  readonly endY: number
  readonly kind: EdgeKind
  readonly drawArrow: boolean
  readonly turnY: number
}): Cell[] => {
  const { startX, endX, startY, endY, turnY } = input
  const dev = input.kind === "dev"
  const vert = dev ? "╎" : "│"
  const tail = input.drawArrow
    ? { x: endX, y: endY - 1, ch: dev ? "▽" : "▼" }
    : { x: endX, y: endY, ch: vert }
  return [
    ..._range({ from: startY, to: turnY }).map((y) => ({ x: startX, y, ch: vert })),
    ..._turnCells({ startX, endX, turnY, vert }),
    ..._range({ from: turnY + 1, to: endY - (input.drawArrow ? 1 : 0) }).map((y) => ({ x: endX, y, ch: vert })),
    tail
  ]
}
