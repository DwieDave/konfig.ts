import { describe, expect, it } from "vitest"
import * as A from "./index"

describe("public api surface", () => {
  it("exposes the 0.4.0 top-level runtime exports", () => {
    expect(Object.keys(A).sort()).toEqual([
      "AppOfApps",
      "AppOfAppsResult",
      "Application",
      "Sync",
      "applicationCRFilename",
      "buildCR",
      "emitApplicationCR",
      "serializeApplicationCR"
    ])
  })

  it("Application exposes define, make, module, target", () => {
    expect(Object.keys(A.Application).sort()).toEqual(["define", "make", "module", "target"])
  })

  it("AppOfApps exposes fromModules and make", () => {
    expect(Object.keys(A.AppOfApps).sort()).toEqual(["fromModules", "make"])
  })
})
