import { describe, expect, it } from "@effect/vitest"
import * as Helm from "./Helm"

describe("api/Helm surface", () => {
  it("exposes exactly the public Helm functions", () => {
    expect(Object.keys(Helm).sort()).toEqual([
      "assertMinVersion",
      "cacheFileName",
      "ensureChartTarball",
      "release",
      "timeout"
    ])
  })
})
