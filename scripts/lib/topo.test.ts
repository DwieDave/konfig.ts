import fc from "fast-check"
import { describe, expect, it } from "vitest"
import type { PackageInfo } from "./repo"
import { topoOrder } from "./topo"

const pkg = (name: string, deps: ReadonlyArray<string>): PackageInfo => ({
  dir: name,
  name,
  isPrivate: false,
  scripts: new Set(),
  deps: new Set(deps)
})

const dagArb = fc
  .integer({ min: 1, max: 9 })
  .chain((n) =>
    fc.array(fc.array(fc.nat(), { maxLength: 4 }), { minLength: n, maxLength: n }).map((rows) =>
      rows.map((row, i) => pkg(`p${i}`, i === 0 ? [] : row.map((d) => `p${d % i}`)))
    )
  )
  .chain((pkgs) => fc.shuffledSubarray(pkgs, { minLength: pkgs.length }))

describe("topoOrder", () => {
  it("keeps every package and puts dependencies first", () => {
    fc.assert(
      fc.property(dagArb, (pkgs) => {
        const out = topoOrder(pkgs).map((p) => p.name)
        expect([...out].sort()).toEqual(pkgs.map((p) => p.name).sort())
        for (const p of pkgs) {
          for (const d of p.deps) expect(out.indexOf(d)).toBeLessThan(out.indexOf(p.name))
        }
      })
    )
  })

  it("ignores external deps and survives cycles", () => {
    const out = topoOrder([pkg("a", ["b", "ext"]), pkg("b", ["a"])]).map((p) => p.name)
    expect(out).toEqual(["a", "b"])
  })
})
