import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { type EdgeKind, type GraphEdge, type GraphNode, renderGraph } from "./layout"
import { transitiveReduce } from "./layout/adjacency"

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

    const edges: GraphEdge[] = triples.flatMap(([a, b, kind]) =>
      a === b ? [] : [{ from: `n${Math.min(a, b)}`, to: `n${Math.max(a, b)}`, kind }]
    )

    return { nodes, edges, withDev }
  })

const _closure = (input: { readonly edges: ReadonlyArray<GraphEdge>; readonly size: number }): string[] => {
  const reach = new Set(input.edges.map((e) => `${e.from}>${e.to}`))

  for (let k = 0; k < input.size; k++) {
    for (let i = 0; i < input.size; i++) {
      for (let j = 0; j < input.size; j++) {
        if (reach.has(`n${i}>n${k}`) && reach.has(`n${k}>n${j}`)) reach.add(`n${i}>n${j}`)
      }
    }
  }

  return [...reach].sort()
}

describe("transitiveReduce — per-kind reachability", () => {
  it("preserves runtime-only reachability and all-edge reachability", () => {
    fc.assert(
      fc.property(arbGraph, ({ nodes, edges }) => {
        const reduced = transitiveReduce(edges)
        const runtime = (es: ReadonlyArray<GraphEdge>) => es.filter((e) => e.kind === "runtime")
        const size = nodes.length
        expect(_closure({ edges: runtime(reduced), size })).toEqual(_closure({ edges: runtime(edges), size }))
        expect(_closure({ edges: reduced, size })).toEqual(_closure({ edges, size }))
      }),
      { numRuns: 200 }
    )
  })

  it("keeps a runtime edge that is only implied through a dev path", () => {
    const edges: GraphEdge[] = [
      { from: "a", to: "c", kind: "runtime" },
      { from: "a", to: "b", kind: "dev" },
      { from: "b", to: "c", kind: "runtime" }
    ]

    expect(transitiveReduce(edges)).toContainEqual({ from: "a", to: "c", kind: "runtime" })
  })
})

describe("renderGraph — layout property tests", () => {
  it("is deterministic — rendering the same input twice produces identical output", () => {
    fc.assert(
      fc.property(arbGraph, ({ nodes, edges, withDev }) => {
        const input = { nodes, edges, target: undefined, withDev, reduce: false }
        const first = renderGraph(input)
        const second = renderGraph({ ...input })
        expect(second).toBe(first)
      }),
      { numRuns: 100 }
    )
  })

  it("renders a header workspace count equal to the number of input nodes", () => {
    fc.assert(
      fc.property(arbGraph, ({ nodes, edges, withDev }) => {
        const out = renderGraph({ nodes, edges, target: undefined, withDev, reduce: false })
        expect(out).toContain(`${nodes.length} workspaces`)
      }),
      { numRuns: 100 }
    )
  })
})

const _parseTreeLine = (line: string): { readonly depth: number; readonly name: string } | undefined => {
  const branch = /^((?:│   |    )*)(?:├── |└── )(n\d+)/.exec(line)
  const root = /^(n\d+)\s/.exec(line)

  return branch
    ? { depth: (branch[1] ?? "").length / 4 + 1, name: branch[2] ?? "" }
    : root
    ? { depth: 0, name: root[1] ?? "" }
    : undefined
}

const _treeChildren = (out: string): ReadonlyArray<ReadonlyArray<string>> => {
  const parsed = out.split("\n").flatMap((line) => _parseTreeLine(line) ?? [])

  return parsed.map((entry, index) => {
    const next = parsed.slice(index + 1)
    const end = next.findIndex((later) => later.depth <= entry.depth)

    return (end === -1 ? next : next.slice(0, end))
      .filter((later) => later.depth === entry.depth + 1)
      .map((later) => later.name)
  })
}

describe("renderGraph — duplicate edges", () => {
  it("never repeats a child under a parent and counts distinct (from,to) pairs", () => {
    fc.assert(
      fc.property(arbGraph, ({ nodes, edges }) => {
        const out = renderGraph({ nodes, edges, target: undefined, withDev: true, reduce: false })
        const runtime = new Set(edges.filter((e) => e.kind === "runtime").map((e) => `${e.from}>${e.to}`))
        const dev = new Set(edges.map((e) => `${e.from}>${e.to}`).filter((k) => !runtime.has(k))).size
        expect(out).toContain(`${runtime.size} runtime edge`)
        expect(out).toContain(`${dev} dev edge`)

        for (const names of _treeChildren(out)) {
          expect(new Set(names).size).toBe(names.length)
        }
      }),
      { numRuns: 100 }
    )
  })
})
