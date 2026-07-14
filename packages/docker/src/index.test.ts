import { describe, expect, it } from "vitest"
import { PACKAGE_NAME } from "./index"

describe("@konfig.ts/docker", () => {
  it("exports its package name", () => {
    expect(PACKAGE_NAME).toBe("@konfig.ts/docker")
  })
})
