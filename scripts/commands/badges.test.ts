import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { makeStubLayer } from "../lib/stubFs"
import { _writeAllBadges, coverageColor, makeStats, RepoStats } from "./badges"

describe("makeStats", () => {
  it("rounds line coverage to one decimal and keeps the raw counts", () => {
    const stats = makeStats({
      tests: 707,
      linesCovered: 3167,
      linesTotal: 3312,
      effectVersion: "4.0.0-rc.109",
      packages: 9
    })

    expect(stats.lineCoverage).toBe(95.6)
    expect(stats.linesCovered).toBe(3167)
    expect(Effect.runSync(Schema.decodeEffect(RepoStats)(stats))).toEqual(stats)
  })

  it("reports 0% coverage when there are no lines", () => {
    expect(makeStats({ tests: 0, linesCovered: 0, linesTotal: 0, effectVersion: "x", packages: 0 }).lineCoverage).toBe(
      0
    )
  })
})

describe("coverageColor", () => {
  it("maps thresholds to colors", () => {
    expect([95, 90, 80, 75, 65, 60, 10].map(coverageColor)).toEqual([
      "#4c1",
      "#4c1",
      "#a3c51c",
      "#a3c51c",
      "#dfb317",
      "#dfb317",
      "#e05d44"
    ])
  })
})

describe("_writeAllBadges", () => {
  it("writes the four badge files into outDir", () => {
    const files = new Map<string, string>()
    const stats = makeStats({ tests: 5, linesCovered: 9, linesTotal: 10, effectVersion: "4.0.0", packages: 2 })
    Effect.runSync(
      _writeAllBadges({ outDir: "/out", pct: 90, tests: 5, effectVersion: "4.0.0", stats }).pipe(
        Effect.provide(makeStubLayer(files))
      )
    )
    expect([...files.keys()].sort()).toEqual([
      "/out/coverage.svg",
      "/out/effect.svg",
      "/out/stats.json",
      "/out/tests.svg"
    ])
    expect(files.get("/out/coverage.svg")).toContain("90.0%")
    expect(files.get("/out/tests.svg")).toContain("5")
    expect(files.get("/out/effect.svg")).toContain("4.0.0")
    expect(files.get("/out/stats.json")).toBe(`${JSON.stringify(stats, null, 2)}\n`)
  })
})
