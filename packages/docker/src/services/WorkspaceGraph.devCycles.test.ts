import { Effect, Exit, Schema } from "effect"
import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { CircularWorkspaceDep, WorkspaceConfigInvalid } from "../DockerError"
import { closureByRef } from "../testing/closure"
import { _decodeConfigYaml, type Workspace } from "./WorkspaceGraph"

const ws = (input: { name: string; deps?: ReadonlyArray<string>; dev?: ReadonlyArray<string> }): Workspace => ({
  name: input.name,
  relDir: `packages/${input.name}`,
  pkg: {
    name: input.name,
    dependencies: Object.fromEntries((input.deps ?? []).map((d) => [d, "workspace:*"])),
    devDependencies: Object.fromEntries((input.dev ?? []).map((d) => [d, "workspace:*"]))
  },
  hasBuildScript: false
})

const names = (exit: Exit.Exit<ReadonlyArray<Workspace>, unknown>): ReadonlyArray<string> =>
  Exit.isSuccess(exit) ? exit.value.map((w) => w.name).sort() : []

describe("closureOf dev-only cycles", () => {
  const all = [
    ws({ name: "app", deps: ["lib"] }),
    ws({ name: "lib", dev: ["test-utils"] }),
    ws({ name: "test-utils", deps: ["lib"] })
  ]

  it("includeDev succeeds when the cycle exists only through devDependencies", () => {
    expect(names(Effect.runSyncExit(closureByRef({ all, ref: "app", includeDev: true })))).toEqual([
      "app",
      "lib",
      "test-utils"
    ])
    expect(names(Effect.runSyncExit(closureByRef({ all, ref: "app" })))).toEqual(["app", "lib"])
  })

  it("runtime-only cycles still fail", () => {
    const cyc = [ws({ name: "a", deps: ["b"] }), ws({ name: "b", deps: ["a"] })]

    for (const includeDev of [false, true]) {
      const exit = Effect.runSyncExit(closureByRef({ all: cyc, ref: "a", includeDev }))
      expect(Exit.isFailure(exit)).toBe(true)
      expect(JSON.stringify(exit)).toContain("CircularWorkspaceDep")
    }

    expect(new CircularWorkspaceDep({ cycle: [] })._tag).toBe("CircularWorkspaceDep")
  })

  it("random runtime DAG plus dev back-edges never fails and equals reachability", () => {
    const arb = fc.tuple(
      fc.array(fc.tuple(fc.nat(7), fc.nat(7)), { maxLength: 14 }),
      fc.array(fc.tuple(fc.nat(7), fc.nat(7)), { maxLength: 14 })
    )

    fc.assert(
      fc.property(arb, ([rt, dv]) => {
        const nm = (i: number) => `w${i}`
        const rtEdges = rt.filter(([a, b]) => a < b)

        const workspaces = Array.from({ length: 8 }, (_, i) =>
          ws({
            name: nm(i),
            deps: rtEdges.filter(([a]) => a === i).map(([, b]) => nm(b)),
            dev: dv.filter(([a]) => a === i).map(([, b]) => nm(b))
          }))

        const edges = [...rtEdges, ...dv]

        const reach = (seen: ReadonlySet<number>, n: number): ReadonlySet<number> =>
          seen.has(n)
            ? seen
            : edges.filter(([a]) => a === n).reduce(
              (s: ReadonlySet<number>, [, b]) => reach(s, b),
              new Set<number>([...seen, n])
            )

        const expected = [...reach(new Set(), 0)].map(nm).sort()
        const exit = Effect.runSyncExit(closureByRef({ all: workspaces, ref: "w0", includeDev: true }))
        expect(Exit.isSuccess(exit)).toBe(true)
        expect(names(exit)).toEqual(expected)
      })
    )
  })
})

describe("_decodeConfigYaml", () => {
  const schema = Schema.Struct({ packages: Schema.optionalKey(Schema.Array(Schema.String)) })
  const run = (text: string) => Effect.runSyncExit(_decodeConfigYaml({ path: "/x/cfg.yaml", text, schema }))

  it("decodes empty and null documents as {}", () => {
    expect(run("")).toEqual(Exit.succeed({}))
    expect(run("~")).toEqual(Exit.succeed({}))
  })

  it("fails with WorkspaceConfigInvalid carrying the path", () => {
    for (const text of ["a: [", "packages: [1]"]) {
      const exit = run(text)
      expect(Exit.isFailure(exit)).toBe(true)
      const err = Exit.isFailure(exit) ? exit.cause.reasons[0] : undefined
      const e = err && "error" in err ? err.error : undefined
      expect(e).toBeInstanceOf(WorkspaceConfigInvalid)
      expect(e instanceof WorkspaceConfigInvalid && e.path).toBe("/x/cfg.yaml")
    }
  })
})
