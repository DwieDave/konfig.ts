import { activeEdges, reachableFromTarget, transitiveReduce } from "./adjacency"
import { groupLayers, insertDummies } from "./layers"
import { barycenterReorder } from "./order"
import { CharGrid, renderBoxLines } from "./paint"
import { layoutLayers } from "./place"
import { computeRanks } from "./rank"
import { routeBoundary, type RouteContext } from "./route"
import { computeNodeSlots } from "./slots"
import { renderTree } from "./tree"
import {
  BOX_ROWS,
  BUILD_TOKEN,
  type GraphEdge,
  type GraphNode,
  type LaidNode,
  type LayoutEdgeData,
  MIN_ROUTE_ROWS,
  type RenderInput,
  type SlotMap
} from "./types"

const _renderHeader = (input: {
  readonly target: string | undefined
  readonly edges: ReadonlyArray<GraphEdge>
  readonly nodeCount: number
  readonly withDev: boolean
  readonly reduce: boolean
}): string => {
  const count = (kind: GraphEdge["kind"]): number => input.edges.filter((e) => e.kind === kind).length
  const plural = (n: number): string => (n === 1 ? "" : "s")
  const parts = [
    `${input.nodeCount} workspaces`,
    `${count("runtime")} runtime edge${plural(count("runtime"))}`,
    ...(input.withDev ? [`${count("dev")} dev edge${plural(count("dev"))}`] : []),
    ...(input.reduce ? [] : ["full"])
  ]
  const label = input.target ? `closure: ${input.target}` : "monorepo workspaces"
  return `${label}  ·  ${parts.join("  ·  ")}`
}

const _renderLegend = (input: { readonly withDev: boolean; readonly showBuild: boolean }): string => {
  const items = [
    ...(input.showBuild ? [`${BUILD_TOKEN} = has build script`] : []),
    "▼ = runtime edge",
    ...(input.withDev ? ["▽ = dev edge"] : [])
  ]
  return `legend:  ${items.join("   ")}`
}

const _computeSlotsByNode = (input: {
  readonly canvas: ReadonlyArray<ReadonlyArray<LaidNode>>
  readonly edges: ReadonlyArray<LayoutEdgeData>
  readonly positions: ReadonlyMap<string, LaidNode>
}): Map<string, SlotMap> => {
  const slotsByNode = new Map<string, SlotMap>()
  for (const ln of input.canvas.flat()) {
    slotsByNode.set(
      ln.data.name,
      computeNodeSlots({ laid: ln, edges: input.edges, positions: input.positions, slotsByNode })
    )
  }
  return slotsByNode
}

const _groupEdgesByBoundary = (input: {
  readonly edges: ReadonlyArray<LayoutEdgeData>
  readonly positions: ReadonlyMap<string, LaidNode>
}): Map<number, LayoutEdgeData[]> =>
  input.edges.reduce((acc, e) => {
    const fromNode = input.positions.get(e.from)
    if (fromNode) acc.set(fromNode.layerIndex, [...(acc.get(fromNode.layerIndex) ?? []), e])
    return acc
  }, new Map<number, LayoutEdgeData[]>())

const _layerTopRows = (input: { readonly routeRowsAt: ReadonlyArray<number> }): number[] =>
  input.routeRowsAt.reduce<number[]>(
    (tops, rows) => [...tops, (tops[tops.length - 1] ?? 0) + BOX_ROWS + rows],
    [0]
  )

const _paintBoxes = (input: {
  readonly grid: CharGrid
  readonly canvas: ReadonlyArray<ReadonlyArray<LaidNode>>
  readonly layerTopRow: ReadonlyArray<number>
  readonly slotsByNode: ReadonlyMap<string, SlotMap>
}): void => {
  input.canvas.forEach((layer, li) => {
    for (const laid of layer) {
      const slots = input.slotsByNode.get(laid.data.name)
      const lines = renderBoxLines({
        laid,
        outgoingSlots: slots ? Array.from(slots.outgoingSlotX.values()) : [],
        incomingSlots: slots ? Array.from(slots.incomingSlotX.values()) : []
      })
      lines.forEach((text, r) => input.grid.putString({ x: laid.boxStartX, y: (input.layerTopRow[li] ?? 0) + r, text }))
    }
  })
}

const _renderDag = (input: {
  readonly canvas: ReadonlyArray<ReadonlyArray<LaidNode>>
  readonly canvasWidth: number
  readonly edges: ReadonlyArray<LayoutEdgeData>
}): string => {
  const positions = new Map(input.canvas.flat().map((ln) => [ln.data.name, ln]))
  const slotsByNode = _computeSlotsByNode({ canvas: input.canvas, edges: input.edges, positions })
  const byBoundary = _groupEdgesByBoundary({ edges: input.edges, positions })
  const routeRowsAt = Array.from(
    { length: Math.max(0, input.canvas.length - 1) },
    (_unused, i) => Math.max(MIN_ROUTE_ROWS, (byBoundary.get(i)?.length ?? 0) + 1)
  )
  const layerTopRow = _layerTopRows({ routeRowsAt })
  const grid = new CharGrid({
    width: input.canvasWidth,
    height: (layerTopRow[input.canvas.length - 1] ?? 0) + BOX_ROWS
  })
  _paintBoxes({ grid, canvas: input.canvas, layerTopRow, slotsByNode })
  const ctx: RouteContext = { positions, slotsByNode, layerTopRow, routeRowsAt }
  for (const [boundary, edges] of byBoundary) grid.putAll(routeBoundary({ boundary, edges, ctx }))
  return grid.toString()
}

const _scopeOf = (input: RenderInput): { nodes: GraphNode[]; edges: GraphEdge[] } => {
  const filtered = activeEdges({ edges: input.edges, withDev: input.withDev })
  const scope = input.target !== undefined
    ? reachableFromTarget({ nodes: input.nodes, edges: filtered, target: input.target })
    : { nodes: input.nodes.slice(), edges: filtered }
  return { nodes: scope.nodes, edges: input.reduce === true ? transitiveReduce(scope.edges) : scope.edges }
}

const _emptyMessage = (target: string | undefined): string =>
  target !== undefined ? `(target '${target}' not found in workspace set)` : "(no workspaces found)"

export const renderGraph = (input: RenderInput): string => {
  const { nodes, edges } = _scopeOf(input)
  if (nodes.length === 0) return _emptyMessage(input.target)
  const ranks = computeRanks({ nodes, edges, target: input.target })
  const { layoutNodes, layoutEdges } = insertDummies({ nodes, edges, ranks })
  const layers = barycenterReorder({ layers: groupLayers(layoutNodes), edges: layoutEdges })
  const { canvas, canvasWidth } = layoutLayers({ layers, edges: layoutEdges })
  const header = _renderHeader({
    target: input.target,
    edges,
    nodeCount: nodes.length,
    withDev: input.withDev,
    reduce: input.reduce === true
  })
  const legend = _renderLegend({ withDev: input.withDev, showBuild: nodes.some((n) => n.hasBuildScript) })
  if (canvasWidth > input.width) {
    const notice =
      `⚠ graph wider than terminal (${canvasWidth} > ${input.width} cols); falling back to tree view.  Pass --width to override.`
    return [header, notice, "", renderTree({ nodes, edges, target: input.target }), "", legend].join("\n")
  }
  return [header, "", _renderDag({ canvas, canvasWidth, edges: layoutEdges }), "", legend].join("\n")
}
