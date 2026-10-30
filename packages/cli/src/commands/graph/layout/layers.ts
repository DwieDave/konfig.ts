import type { GraphEdge, GraphNode, LayoutEdgeData, LayoutNodeData } from "./types"

interface Expanded {
  readonly dummies: LayoutNodeData[]
  readonly edges: LayoutEdgeData[]
}

const _expandEdge = (input: {
  readonly edge: GraphEdge
  readonly ranks: ReadonlyMap<string, number>
  readonly dummyStart: number
}): Expanded => {
  const { edge, ranks, dummyStart } = input
  const fromRank = ranks.get(edge.from) ?? 0
  const toRank = ranks.get(edge.to) ?? 0
  const dummies: LayoutNodeData[] = Array.from({ length: Math.max(0, toRank - fromRank - 1) }, (_unused, i) => ({
    name: `__dummy_${dummyStart + i}`,
    real: null,
    rank: fromRank + 1 + i
  }))
  const chain = [edge.from, ...dummies.map((d) => d.name), edge.to]
  const edges = chain.slice(0, -1).map((from, i): LayoutEdgeData => ({
    from,
    to: chain[i + 1] ?? edge.to,
    kind: edge.kind,
    isFinal: i === chain.length - 2
  }))
  return { dummies, edges }
}

export const insertDummies = (input: {
  readonly nodes: ReadonlyArray<GraphNode>
  readonly edges: ReadonlyArray<GraphEdge>
  readonly ranks: ReadonlyMap<string, number>
}): { layoutNodes: LayoutNodeData[]; layoutEdges: LayoutEdgeData[] } => {
  const layoutNodes: LayoutNodeData[] = input.nodes.map((n) => ({
    name: n.name,
    real: n,
    rank: input.ranks.get(n.name) ?? 0
  }))
  const layoutEdges: LayoutEdgeData[] = []
  let dummyCount = 0
  for (const edge of input.edges) {
    const expanded = _expandEdge({ edge, ranks: input.ranks, dummyStart: dummyCount })
    dummyCount += expanded.dummies.length
    layoutNodes.push(...expanded.dummies)
    layoutEdges.push(...expanded.edges)
  }
  return { layoutNodes, layoutEdges }
}

const _compareInitial = (a: LayoutNodeData, b: LayoutNodeData): number => {
  if (a.real === null && b.real !== null) return 1
  if (a.real !== null && b.real === null) return -1
  return a.name.localeCompare(b.name)
}

export const groupLayers = (layoutNodes: ReadonlyArray<LayoutNodeData>): LayoutNodeData[][] => {
  const maxRank = Math.max(0, ...layoutNodes.map((n) => n.rank))
  return Array.from(
    { length: maxRank + 1 },
    (_unused, rank) => layoutNodes.filter((n) => n.rank === rank).sort(_compareInitial)
  )
}
