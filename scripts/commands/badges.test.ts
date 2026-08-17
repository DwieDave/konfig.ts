import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { _makeStats, RepoStats } from "./badges"

describe("_makeStats", () => {
  it("rounds line coverage to one decimal and keeps the raw counts", () => {
    const stats = _makeStats({
      tests: 707,
      linesCovered: 3167,
      linesTotal: 3312,
      effectVersion: "4.0.0-rc.109",
      packages: 9
    })
    expect(stats.lineCoverage).toBe(95.6)
    expect(stats.linesCovered).toBe(3167)
    expect(Schema.decodeUnknownSync(RepoStats)(stats)).toEqual(stats)
  })

  it("reports 0% coverage when there are no lines", () => {
    expect(_makeStats({ tests: 0, linesCovered: 0, linesTotal: 0, effectVersion: "x", packages: 0 }).lineCoverage).toBe(
      0
    )
  })
})
