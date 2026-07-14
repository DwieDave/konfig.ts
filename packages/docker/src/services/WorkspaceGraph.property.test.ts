import { Effect, Exit } from "effect"
import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { CircularWorkspaceDep, WorkspaceNotFound } from "../DockerError"
import { closureOf, type Workspace } from "./WorkspaceGraph"

const _ws = (name: string, deps: ReadonlyArray<string>): Workspace => ({
  name,
  relDir: `packages/${name.replace(/^@[^/]+\//, "")}`,
  pkg: {
    name,
    dependencies: Object.fromEntries(deps.map((d) => [d, "workspace:*"]))
  },
  hasBuildScript: false
})

/**
 * Builds a DAG: nodes "A".."Z" with random forward-only edges
 * (i ↔ alpha[i] → alpha[j] only if j > i). Always acyclic by construction.
 */
const arbDag = fc
  .array(fc.integer({ min: 2, max: 15 }), { minLength: 1, maxLength: 1 })
  .chain(([n]) => {
    const size = n ?? 5
    return fc.tuple(
      fc.constant(size),
      fc.array(
        fc.tuple(fc.integer({ min: 0, max: size - 1 }), fc.integer({ min: 0, max: size - 1 })),
        { minLength: 0, maxLength: size * 2 }
      )
    )
  })
  .map(([size, edgePairs]) => {
    const names = Array.from({ length: size }, (_, i) => `@fix/p${i}`)
    const deps: Record<string, string[]> = Object.fromEntries(names.map((n) => [n, [] as string[]]))
    for (const [a, b] of edgePairs) {
      // Forward edges only so the result is acyclic.
      const from = Math.min(a, b)
      const to = Math.max(a, b)
      if (from === to) continue
      const fromName = names[from]!
      const toName = names[to]!
      if (!deps[fromName]!.includes(toName)) deps[fromName]!.push(toName)
    }
    return { names, deps }
  })

describe("closureOf — property tests", () => {
  it("the closure of a target contains exactly the transitive reachable set", async () => {
    await fc.assert(
      fc.asyncProperty(arbDag, async ({ names, deps }) => {
        const all = names.map((n) => _ws(n, deps[n] ?? []))
        const target = names[0]!
        const result = await Effect.runPromise(
          Effect.exit(closureOf({ all, target }))
        )
        if (!Exit.isSuccess(result)) return

        // Compute the expected closure by BFS over deps.
        const seen = new Set<string>()
        const stack = [target]
        while (stack.length > 0) {
          const cur = stack.pop()!
          if (seen.has(cur)) continue
          seen.add(cur)
          for (const d of deps[cur] ?? []) stack.push(d)
        }
        const closureNames = new Set(result.value.map((w) => w.name))
        expect(closureNames).toEqual(seen)
      }),
      { numRuns: 100 }
    )
  })

  it("the closure ends with the target — dep-first topological order", async () => {
    await fc.assert(
      fc.asyncProperty(arbDag, async ({ names, deps }) => {
        const all = names.map((n) => _ws(n, deps[n] ?? []))
        const target = names[0]!
        const result = await Effect.runPromise(Effect.exit(closureOf({ all, target })))
        if (!Exit.isSuccess(result)) return
        const last = result.value[result.value.length - 1]
        expect(last?.name).toBe(target)
      }),
      { numRuns: 100 }
    )
  })

  it("returns WorkspaceNotFound for a target that doesn't exist", async () => {
    const all = [_ws("@fix/a", [])]
    const result = await Effect.runPromise(
      Effect.exit(closureOf({ all, target: "@fix/missing" }))
    )
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      const json = JSON.stringify(result.cause)
      expect(json).toContain("WorkspaceNotFound")
    }
  })

  it("detects a self-cycle", async () => {
    const all = [_ws("@fix/a", ["@fix/a"])]
    const result = await Effect.runPromise(
      Effect.exit(closureOf({ all, target: "@fix/a" }))
    )
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      const json = JSON.stringify(result.cause)
      expect(json).toContain("CircularWorkspaceDep")
    }
  })

  it("detects a 3-cycle", async () => {
    const all = [
      _ws("@fix/a", ["@fix/b"]),
      _ws("@fix/b", ["@fix/c"]),
      _ws("@fix/c", ["@fix/a"])
    ]
    const result = await Effect.runPromise(
      Effect.exit(closureOf({ all, target: "@fix/a" }))
    )
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      const json = JSON.stringify(result.cause)
      expect(json).toContain("CircularWorkspaceDep")
    }
  })

  void WorkspaceNotFound
  void CircularWorkspaceDep
})
