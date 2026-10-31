import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { diffSurface, parseExports } from "./apiSurface"

describe("parseExports", () => {
  it("collects value, type and declaration exports and records star re-exports", () => {
    const code = [
      `export { a, type B, C as D } from "./x"`,
      `export * as Ns from "./ns"`,
      `export * from "./all"`,
      `export type T = 1`,
      `export interface I {}`,
      `export const v = 1, w = 2`,
      `export function f() {}`,
      `export class K {}`
    ].join("\n")

    const parsed = parseExports({ file: "index.ts", code })

    expect([...parsed.names].sort()).toEqual(["B", "D", "I", "K", "T", "a", "f", "v", "w"])
    expect(parsed.stars).toEqual([{ from: "./ns", alias: "Ns" }, { from: "./all", alias: undefined }])
  })
})

describe("diffSurface", () => {
  const names = fc.uniqueArray(fc.stringMatching(/^[A-Za-z][A-Za-z.]{0,8}$/), { maxLength: 12 })

  it("reports exactly the names missing from or new in the current surface", () => {
    fc.assert(
      fc.property(names, names, (recorded, current) => {
        const diff = diffSurface({ recorded, current })

        expect(new Set(diff.removed)).toEqual(new Set(recorded.filter((n) => !current.includes(n))))
        expect(new Set(diff.added)).toEqual(new Set(current.filter((n) => !recorded.includes(n))))
      })
    )
  })

  it("is empty when nothing changed", () => {
    fc.assert(
      fc.property(names, (same) => {
        expect(diffSurface({ recorded: same, current: same })).toEqual({ removed: [], added: [] })
      })
    )
  })
})
