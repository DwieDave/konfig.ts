import { reverseAdjacency } from "./adjacency"
import type { GraphEdge, GraphNode } from "./types"

const _initialRanks = (input: {
  readonly nodes: ReadonlyArray<GraphNode>
  readonly edges: ReadonlyArray<GraphEdge>
  readonly target: string | undefined
}): Map<string, number> => {
  if (input.target !== undefined) return new Map([[input.target, 0]])
  const rev = reverseAdjacency(input.edges)
  return new Map(input.nodes.filter((n) => (rev.get(n.name)?.length ?? 0) === 0).map((n) => [n.name, 0]))
}

const _relaxOnce = (input: {
  readonly edges: ReadonlyArray<GraphEdge>
  readonly ranks: Map<string, number>
}): boolean => {
  let changed = false
  for (const e of input.edges) {
    const fromRank = input.ranks.get(e.from)
    const current = input.ranks.get(e.to)
    if (fromRank !== undefined && (current === undefined || current < fromRank + 1)) {
      input.ranks.set(e.to, fromRank + 1)
      changed = true
    }
  }
  return changed
}

export const computeRanks = (input: {
  readonly nodes: ReadonlyArray<GraphNode>
  readonly edges: ReadonlyArray<GraphEdge>
  readonly target: string | undefined
}): Map<string, number> => {
  const ranks = _initialRanks(input)
  const maxIterations = input.nodes.length * input.nodes.length + 1
  for (let i = 0; i < maxIterations && _relaxOnce({ edges: input.edges, ranks }); i++);
  for (const n of input.nodes) if (!ranks.has(n.name)) ranks.set(n.name, 0)
  return ranks
}
