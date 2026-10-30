import { activeEdges, adjacency, reachableFromTarget } from "./adjacency"
import type { CycleInput } from "./types"

type Colour = "white" | "grey" | "black"

interface CycleState {
  readonly adj: ReadonlyMap<string, ReadonlyArray<string>>
  readonly colour: Map<string, Colour>
  readonly path: string[]
}

const _childCycle = (input: { readonly state: CycleState; readonly child: string }): ReadonlyArray<string> | null => {
  const colour = input.state.colour.get(input.child) ?? "white"

  if (colour === "grey") return [...input.state.path.slice(input.state.path.indexOf(input.child)), input.child]

  return colour === "white" ? _visit({ state: input.state, node: input.child }) : null
}

const _visit = (input: { readonly state: CycleState; readonly node: string }): ReadonlyArray<string> | null => {
  const { state, node } = input
  state.colour.set(node, "grey")
  state.path.push(node)

  for (const child of state.adj.get(node) ?? []) {
    const found = _childCycle({ state, child })

    if (found) return found
  }

  state.path.pop()
  state.colour.set(node, "black")

  return null
}

export const detectCycle = (input: CycleInput): ReadonlyArray<string> | null => {
  const active = activeEdges({ edges: input.edges, withDev: input.withDev })

  const scope = input.target === undefined
    ? { nodes: input.nodes, edges: active }
    : reachableFromTarget({ nodes: input.nodes, edges: active, target: input.target })

  const state: CycleState = { adj: adjacency(scope.edges), colour: new Map(), path: [] }

  for (const n of scope.nodes) {
    if ((state.colour.get(n.name) ?? "white") === "white") {
      const found = _visit({ state, node: n.name })

      if (found) return found
    }
  }

  return null
}
