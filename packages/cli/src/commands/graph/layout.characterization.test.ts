import { describe, expect, it } from "vitest"
import type { GraphEdge, GraphNode, RenderInput } from "./layout"
import { detectCycle, renderGraph } from "./layout"

const _lcg = (seed: number) => {
  let state = seed
  return (): number => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

const _nodesOf = (input: { readonly count: number; readonly rand: () => number }): GraphNode[] =>
  Array.from({ length: input.count }, (_unused, i) => ({
    name: `@w/pkg-${i}${input.rand() < 0.3 ? "-long-name" : ""}`,
    relDir: `packages/dir-${i}`,
    hasBuildScript: input.rand() < 0.5
  }))

const _edgesOf = (input: { readonly nodes: ReadonlyArray<GraphNode>; readonly rand: () => number }): GraphEdge[] =>
  input.nodes.flatMap((from, i) =>
    input.nodes.slice(i + 1).flatMap((to): GraphEdge[] =>
      input.rand() < 0.3 ? [{ from: from.name, to: to.name, kind: input.rand() < 0.3 ? "dev" : "runtime" }] : []
    )
  )

const _graph = (seed: number) => {
  const rand = _lcg(seed)
  const nodes = _nodesOf({ count: 1 + Math.floor(rand() * 9), rand })
  return { nodes, edges: _edgesOf({ nodes, rand }), rand }
}

const _variants = (seed: number): RenderInput[] => {
  const { nodes, edges, rand } = _graph(seed)
  const target = nodes[Math.floor(rand() * nodes.length)]?.name
  return [
    { nodes, edges, target: undefined, width: 200, withDev: true, reduce: false },
    { nodes, edges, target: undefined, width: 200, withDev: false, reduce: true },
    { nodes, edges, target, width: 200, withDev: true, reduce: true },
    { nodes, edges, target, width: 30, withDev: true, reduce: false }
  ]
}

describe("renderGraph characterization", () => {
  it("matches the locked output over a seeded corpus", () => {
    const outputs = Array.from({ length: 60 }, (_unused, seed) => seed + 1).flatMap((seed) =>
      _variants(seed).map((v) => renderGraph(v))
    )
    expect(outputs.join("\n=====\n")).toMatchSnapshot()
  })

  it("matches detectCycle over a seeded corpus", () => {
    const results = Array.from({ length: 60 }, (_unused, seed) => seed + 1).map((seed) => {
      const { nodes, edges } = _graph(seed)
      const back: GraphEdge[] = [...edges, {
        from: nodes[nodes.length - 1]?.name ?? "",
        to: nodes[0]?.name ?? "",
        kind: "dev"
      }]
      return [
        detectCycle({ nodes, edges }),
        detectCycle({ nodes, edges: back }),
        detectCycle({ nodes, edges: back, withDev: false })
      ]
    })
    expect(results).toMatchSnapshot()
  })
})
