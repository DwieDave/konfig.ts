import { describe, expect, it } from "vitest"
import * as A from "./index"

describe("public api surface", () => {
  it("Application exposes only define, module, target", () => {
    expect(Object.keys(A.Application).sort()).toEqual(["define", "module", "target"])
  })

  it("AppOfApps exposes only fromModules", () => {
    expect(Object.keys(A.AppOfApps)).toEqual(["fromModules"])
  })
})
