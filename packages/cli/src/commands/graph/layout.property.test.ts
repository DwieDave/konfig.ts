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

/**
 * Extracts the (x, y) rectangle of every drawn box from a rendered DAG by
 * scanning box top-left corners ("┌") and matching them to node names on
 * the following name row. Only meaningful when the graph rendered as a DAG
 * (not the tree-view fallback), so callers should use a generous width.
 */
const _extractBoxes = (
  rendered: string,
  names: ReadonlyArray<string>
): Array<{ name: string; x0: number; x1: number; y0: number; y1: number }> => {
  const lines = rendered.split("\n")
  const boxes: Array<{ name: string; x0: number; x1: number; y0: number; y1: number }> = []
  for (let y = 0; y < lines.length; y++) {
    const line = lines[y] ?? ""
    for (let x = 0; x < line.length; x++) {
      if (line[x] !== "┌") continue
      const x1 = line.indexOf("┐", x)
      if (x1 < 0) continue
      const nameLine = lines[y + 1] ?? ""
      const segment = nameLine.slice(x, x1 + 1)
      const match = names.find((n) => segment.includes(n))
      if (match) boxes.push({ name: match, x0: x, x1, y0: y, y1: y + 3 })
    }
  }
  return boxes
}

const _rectsOverlap = (
  a: { x0: number; x1: number; y0: number; y1: number },
  b: { x0: number; x1: number; y0: number; y1: number }
): boolean => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1

describe("renderGraph — layout property tests", () => {
  it("never draws two node boxes on overlapping rectangles", () => {
    fc.assert(
      fc.property(arbGraph, ({ nodes, edges, withDev }) => {
        const out = renderGraph({ nodes, edges, target: undefined, width: 100_000, withDev })
        const boxes = _extractBoxes(out, nodes.map((n) => n.name))
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const bi = boxes[i]
            const bj = boxes[j]
            if (!bi || !bj) continue
            expect(_rectsOverlap(bi, bj)).toBe(false)
          }
        }
      }),
      { numRuns: 100 }
    )
  })

  it("is deterministic — rendering the same input twice produces identical output", () => {
    fc.assert(
      fc.property(arbGraph, ({ nodes, edges, withDev }) => {
        const input = { nodes, edges, target: undefined, width: 100_000, withDev }
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
        const out = renderGraph({ nodes, edges, target: undefined, width: 100_000, withDev })
        expect(out).toContain(`${nodes.length} workspaces`)
      }),
      { numRuns: 100 }
    )
  })
})
