import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { detectCycle, type EdgeKind, type GraphEdge, type GraphNode, renderGraph } from "./layout"

/**
 * Builds a DAG over node names "n0".."n{size-1}" with forward-only edges
 * (i -> j only if j > i), so the result is always acyclic by construction —
 * mirroring the arbDag pattern from WorkspaceGraph.property.test.ts.
 */
const arbGraph = fc
  .integer({ min: 1, max: 8 })
  .chain((size) =>
    fc.tuple(
      fc.constant(size),
      fc.array(
        fc.tuple(
          fc.integer({ min: 0, max: size - 1 }),
          fc.integer({ min: 0, max: size - 1 }),
          fc.constantFrom<EdgeKind>("runtime", "dev")
        ),
        { minLength: 0, maxLength: size * 2 }
      ),
      fc.boolean()
    )
  )
  .map(([size, triples, withDev]) => {
    const nodes: GraphNode[] = Array.from({ length: size }, (_unused, i) => ({
      name: `n${i}`,
      relDir: `packages/n${i}`,
      hasBuildScript: i % 2 === 0
    }))

    const seen = new Set<string>()
    const edges: GraphEdge[] = []

    for (const [a, b, kind] of triples) {
      const from = Math.min(a, b)
      const to = Math.max(a, b)

      if (from === to) continue
      const key = `n${from}->n${to}`

      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ from: `n${from}`, to: `n${to}`, kind })
    }

    return { nodes, edges, withDev }
  })

describe("renderGraph — layout property tests", () => {
  it("is deterministic — rendering the same input twice produces identical output", () => {
    fc.assert(
      fc.property(arbGraph, ({ nodes, edges, withDev }) => {
        const input = { nodes, edges, target: undefined, withDev }
        const first = renderGraph(input)
        const second = renderGraph({ ...input })
        expect(second).toBe(first)
      }),
      { numRuns: 100 }
    )
  })

  it("detectCycle finds no cycle in any forward-only-edge DAG", () => {
    fc.assert(
      fc.property(arbGraph, ({ nodes, edges, withDev }) => {
        const cycle = detectCycle({ nodes, edges, withDev })
        expect(cycle).toBeNull()
      }),
      { numRuns: 100 }
    )
  })

  it("detectCycle reports a cycle once a back-edge closes the loop", () => {
    fc.assert(
      fc.property(arbGraph.filter(({ nodes }) => nodes.length >= 2), ({ nodes, edges }) => {
        if (edges.length === 0) return
        const last = edges[edges.length - 1]

        if (!last) return
        const backEdge: GraphEdge = { from: last.to, to: last.from, kind: last.kind }
        const withCycle = [...edges, backEdge]
        const cycle = detectCycle({ nodes, edges: withCycle, withDev: true })
        expect(cycle).not.toBeNull()

        if (cycle) {
          expect(cycle[0]).toBe(cycle[cycle.length - 1])
        }
      }),
      { numRuns: 100 }
    )
  })

  it("renders a header workspace count equal to the number of input nodes", () => {
    fc.assert(
      fc.property(arbGraph, ({ nodes, edges, withDev }) => {
        const out = renderGraph({ nodes, edges, target: undefined, withDev })
        expect(out).toContain(`${nodes.length} workspaces`)
      }),
      { numRuns: 100 }
    )
  })
})
