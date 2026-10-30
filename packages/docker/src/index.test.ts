import { describe, expect, it } from "vitest"
import * as api from "./index"

describe("@konfig.ts/docker public API", () => {
  it("exports sibling package managers and every raised error", () => {
    expect(api.yarnPm({ variant: "classic" })._tag).toBe("Yarn")
    expect(new api.PlatformMultiUnsupported({ target: "t", values: [] })._tag).toBe("PlatformMultiUnsupported")
  })
})
