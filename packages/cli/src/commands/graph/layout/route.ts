import { type Cell, routeCells } from "./paint"
import { BOX_ROWS, type LaidNode, type LayoutEdgeData, MIN_ROUTE_ROWS, type SlotMap } from "./types"

interface PlacedRoute {
  readonly startX: number
  readonly endX: number
  readonly turnY: number
}

interface Candidate extends PlacedRoute {
  readonly parentBotRow: number
  readonly childTopRow: number
}

const CROSSING_COST = 4

const _span = (route: PlacedRoute): { readonly lo: number; readonly hi: number } => ({
  lo: Math.min(route.startX, route.endX),
  hi: Math.max(route.startX, route.endX)
})

const _within = (input: { readonly x: number; readonly lo: number; readonly hi: number }): boolean =>
  input.x >= input.lo && input.x <= input.hi

const _pairCost = (input: { readonly candidate: Candidate; readonly placed: PlacedRoute }): number => {
  const { candidate: c, placed: p } = input
  const mine = _span(c)
  const theirs = _span(p)
  const flags = [
    p.turnY > c.parentBotRow + 1 && _within({ x: p.startX, ...mine }) && p.turnY > c.turnY,
    p.turnY < c.childTopRow - 1 && _within({ x: p.endX, ...mine }) && p.turnY < c.turnY,
    c.turnY > c.parentBotRow + 1 && _within({ x: c.startX, ...theirs }) && p.turnY < c.turnY,
    c.turnY < c.childTopRow - 1 && _within({ x: c.endX, ...theirs }) && p.turnY > c.turnY
  ]
  const overlap = p.turnY === c.turnY && mine.lo <= theirs.hi && theirs.lo <= mine.hi
  return flags.filter(Boolean).length * CROSSING_COST + (overlap ? 1 : 0)
}

const _bestTurnRow = (input: {
  readonly placed: ReadonlyArray<PlacedRoute>
  readonly startX: number
  readonly endX: number
  readonly parentBotRow: number
  readonly childTopRow: number
  readonly turnSlotsCount: number
}): number => {
  const costOf = (turnY: number): number =>
    input.placed.reduce((sum, placed) => sum + _pairCost({ candidate: { ...input, turnY }, placed }), 0)
  const rows = Array.from({ length: input.turnSlotsCount }, (_unused, t) => input.parentBotRow + 1 + t)
  return rows.reduce((best, row) => {
    const cost = costOf(row)
    return cost < best.cost ? { row, cost } : best
  }, { row: input.parentBotRow + 1, cost: Number.POSITIVE_INFINITY }).row
}

const _anchorX = (input: {
  readonly slotsByNode: ReadonlyMap<string, SlotMap>
  readonly edge: LayoutEdgeData
  readonly side: "start" | "end"
}): number | undefined => {
  const { slotsByNode, edge } = input
  return input.side === "start"
    ? slotsByNode.get(edge.from)?.outgoingSlotX.get(edge.to)
    : slotsByNode.get(edge.to)?.incomingSlotX.get(edge.from)
}

const _orderBoundaryEdges = (input: {
  readonly edges: ReadonlyArray<LayoutEdgeData>
  readonly slotsByNode: ReadonlyMap<string, SlotMap>
}): LayoutEdgeData[] => {
  const measure = (edge: LayoutEdgeData) => {
    const start = _anchorX({ slotsByNode: input.slotsByNode, edge, side: "start" }) ?? 0
    const end = _anchorX({ slotsByNode: input.slotsByNode, edge, side: "end" }) ?? 0
    return { start, dist: Math.abs(start - end) }
  }
  return input.edges.slice().sort((a, b) => {
    const ma = measure(a)
    const mb = measure(b)
    return ma.dist === mb.dist ? mb.start - ma.start : mb.dist - ma.dist
  })
}

export interface RouteContext {
  readonly positions: ReadonlyMap<string, LaidNode>
  readonly slotsByNode: ReadonlyMap<string, SlotMap>
  readonly layerTopRow: ReadonlyArray<number>
  readonly routeRowsAt: ReadonlyArray<number>
}

const _geometry = (input: { readonly edge: LayoutEdgeData; readonly ctx: RouteContext }) => {
  const { edge, ctx } = input
  const fromNode = ctx.positions.get(edge.from)
  const toNode = ctx.positions.get(edge.to)
  const startX = _anchorX({ slotsByNode: ctx.slotsByNode, edge, side: "start" })
  const endX = _anchorX({ slotsByNode: ctx.slotsByNode, edge, side: "end" })
  if (!fromNode || !toNode || startX === undefined || endX === undefined) return undefined
  return {
    startX,
    endX,
    parentBotRow: (ctx.layerTopRow[fromNode.layerIndex] ?? 0) + BOX_ROWS - 1,
    childTopRow: ctx.layerTopRow[toNode.layerIndex] ?? 0
  }
}

export const routeBoundary = (input: {
  readonly boundary: number
  readonly edges: ReadonlyArray<LayoutEdgeData>
  readonly ctx: RouteContext
}): Cell[] => {
  const turnSlotsCount = Math.max(1, (input.ctx.routeRowsAt[input.boundary] ?? MIN_ROUTE_ROWS) - 1)
  const placed: PlacedRoute[] = []
  return _orderBoundaryEdges({ edges: input.edges, slotsByNode: input.ctx.slotsByNode }).flatMap((edge) => {
    const geo = _geometry({ edge, ctx: input.ctx })
    if (!geo) return []
    const turnY = _bestTurnRow({ placed, turnSlotsCount, ...geo })
    placed.push({ startX: geo.startX, endX: geo.endX, turnY })
    return routeCells({
      startX: geo.startX,
      endX: geo.endX,
      startY: geo.parentBotRow + 1,
      endY: geo.childTopRow,
      kind: edge.kind,
      drawArrow: edge.isFinal,
      turnY
    })
  })
}
