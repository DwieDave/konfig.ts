import { describe, expect, it } from "vitest"
import { readCoreVersion, readRepoStats } from "./stats"

describe("repo stats", () => {
  it("reads .github/badges/stats.json", () => {
    const s = readRepoStats()
    expect(s.tests).toBeGreaterThan(0)
    expect(s.lineCoverage).toBeGreaterThan(0)
    expect(s.packages).toBeGreaterThan(0)
    expect(s.effectVersion).toMatch(/^4\./)
  })
  it("reads the core package version", () => {
    expect(readCoreVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })
})
