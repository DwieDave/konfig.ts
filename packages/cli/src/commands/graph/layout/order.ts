import { adjacency, reverseAdjacency } from "./adjacency"
import type { LayoutEdgeData, LayoutNodeData } from "./types"

type Neighbours = ReadonlyMap<string, ReadonlyArray<string>>

const _median = (xs: ReadonlyArray<number>): number => {
  if (xs.length === 0) return Number.POSITIVE_INFINITY
  const sorted = xs.slice().sort((a, b) => a - b)
  const mid = sorted.length >> 1
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

const _positions = (layer: ReadonlyArray<LayoutNodeData>): Map<string, number> =>
  new Map(layer.map((n, i) => [n.name, i]))

const _countCrossings = (input: {
  readonly upper: ReadonlyArray<LayoutNodeData>
  readonly lower: ReadonlyArray<LayoutNodeData>
  readonly edges: ReadonlyArray<LayoutEdgeData>
}): number => {
  const upperPos = _positions(input.upper)
  const lowerPos = _positions(input.lower)
  const spans = input.edges
    .filter((e) => upperPos.has(e.from) && lowerPos.has(e.to))
    .map((e) => ({ u: upperPos.get(e.from) ?? 0, l: lowerPos.get(e.to) ?? 0 }))
  return spans.reduce(
    (total, a, i) =>
      total + spans.slice(i + 1).filter((b) => (a.u < b.u && a.l > b.l) || (a.u > b.u && a.l < b.l)).length,
    0
  )
}

const _totalCrossings = (input: {
  readonly layers: ReadonlyArray<ReadonlyArray<LayoutNodeData>>
  readonly edges: ReadonlyArray<LayoutEdgeData>
}): number =>
  input.layers.slice(0, -1).reduce(
    (total, upper, i) => total + _countCrossings({ upper, lower: input.layers[i + 1] ?? [], edges: input.edges }),
    0
  )

const _sweepLayer = (input: {
  readonly layer: LayoutNodeData[]
  readonly reference: ReadonlyArray<LayoutNodeData>
  readonly neighbours: Neighbours
}): void => {
  const pos = _positions(input.reference)
  const score = (n: LayoutNodeData): number =>
    _median((input.neighbours.get(n.name) ?? []).flatMap((p) => {
      const v = pos.get(p)
      return v === undefined ? [] : [v]
    }))
  input.layer.sort((a, b) => {
    const sa = score(a)
    const sb = score(b)
    return sa === sb ? a.name.localeCompare(b.name) : sa - sb
  })
}

const _sweep = (input: {
  readonly layers: LayoutNodeData[][]
  readonly downward: boolean
  readonly adj: Neighbours
  readonly rev: Neighbours
}): void => {
  const { layers, downward } = input
  const count = Math.max(0, layers.length - 1)
  for (let i = 0; i < count; i++) {
    const li = downward ? i + 1 : layers.length - 2 - i
    _sweepLayer({
      layer: layers[li] ?? [],
      reference: layers[downward ? li - 1 : li + 1] ?? [],
      neighbours: downward ? input.rev : input.adj
    })
  }
}

const _copy = (layers: ReadonlyArray<ReadonlyArray<LayoutNodeData>>): LayoutNodeData[][] => layers.map((l) => l.slice())

export const barycenterReorder = (input: {
  readonly layers: LayoutNodeData[][]
  readonly edges: ReadonlyArray<LayoutEdgeData>
}): LayoutNodeData[][] => {
  const adj = adjacency(input.edges)
  const rev = reverseAdjacency(input.edges)
  const next = _copy(input.layers)
  let best = _copy(input.layers)
  let bestCount = _totalCrossings({ layers: best, edges: input.edges })
  for (let pass = 0; pass < 12; pass++) {
    _sweep({ layers: next, downward: pass % 2 === 0, adj, rev })
    const count = _totalCrossings({ layers: next, edges: input.edges })
    if (count < bestCount) {
      bestCount = count
      best = _copy(next)
    }
  }
  return best
}
