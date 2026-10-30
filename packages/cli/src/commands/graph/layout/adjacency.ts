import type { GraphEdge, GraphNode, LinkLike } from "./types"

const _indexBy = (input: {
  readonly edges: ReadonlyArray<LinkLike>
  readonly key: (edge: LinkLike) => string
  readonly value: (edge: LinkLike) => string
}): Map<string, string[]> =>
  input.edges.reduce((acc, edge) => {
    const key = input.key(edge)
    acc.set(key, [...(acc.get(key) ?? []), input.value(edge)])
    return acc
  }, new Map<string, string[]>())

export const adjacency = (edges: ReadonlyArray<LinkLike>): Map<string, string[]> =>
  _indexBy({ edges, key: (e) => e.from, value: (e) => e.to })

export const reverseAdjacency = (edges: ReadonlyArray<LinkLike>): Map<string, string[]> =>
  _indexBy({ edges, key: (e) => e.to, value: (e) => e.from })

export const activeEdges = (input: {
  readonly edges: ReadonlyArray<GraphEdge>
  readonly withDev: boolean
}): GraphEdge[] => (input.withDev ? input.edges.slice() : input.edges.filter((e) => e.kind === "runtime"))

const _bfsReach = (input: {
  readonly adj: ReadonlyMap<string, ReadonlyArray<string>>
  readonly seeds: ReadonlyArray<string>
}): Set<string> => {
  const seen = new Set(input.seeds)
  const queue = [...seen]
  for (let i = 0; i < queue.length; i++) {
    for (const next of input.adj.get(queue[i] ?? "") ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return seen
}

export const reachableFromTarget = (input: {
  readonly nodes: ReadonlyArray<GraphNode>
  readonly edges: ReadonlyArray<GraphEdge>
  readonly target: string
}): { nodes: GraphNode[]; edges: GraphEdge[] } => {
  const reach = _bfsReach({ adj: adjacency(input.edges), seeds: [input.target] })
  return {
    nodes: input.nodes.filter((n) => reach.has(n.name)),
    edges: input.edges.filter((e) => reach.has(e.from) && reach.has(e.to))
  }
}

export const transitiveReduce = (edges: ReadonlyArray<GraphEdge>): GraphEdge[] => {
  const adj = adjacency(edges)
  return edges.filter((e) => {
    const seeds = (adj.get(e.from) ?? []).filter((k) => k !== e.to)
    return !_bfsReach({ adj, seeds }).has(e.to)
  })
}
