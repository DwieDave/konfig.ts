import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { stripExportsMap } from "./prepackExports"

const dot = { types: "./t.d.ts", import: "./i.js", bun: "./src/index.ts", source: "./src/index.ts" }

describe("stripExportsMap", () => {
  it("keeps only types and import in the dot export", () => {
    const next = stripExportsMap({ pkg: { name: "a" }, exportsMap: { ".": dot }, dot, publishConfig: {} })
    expect(next.exports).toEqual({ ".": { types: "./t.d.ts", import: "./i.js" } })
  })

  it("drops publishConfig when exports was its only key", () => {
    const next = stripExportsMap({
      pkg: { publishConfig: { exports: {} } },
      exportsMap: {},
      dot,
      publishConfig: { exports: {} }
    })
    expect("publishConfig" in next).toBe(false)
  })

  it("keeps remaining publishConfig keys", () => {
    fc.assert(fc.property(fc.string({ minLength: 1 }).filter((k) => k !== "exports"), fc.string(), (k, v) => {
      const publishConfig = { exports: {}, [k]: v }
      const next = stripExportsMap({ pkg: { publishConfig }, exportsMap: {}, dot, publishConfig })
      expect(next.publishConfig).toEqual({ [k]: v })
    }))
  })
})
