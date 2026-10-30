import { describe, expect, it } from "vitest"
import { bun } from "./bun"

describe("bun", () => {
  it("installs against the frozen lockfile", () => {
    expect(bun.installCommand).toContain("--frozen-lockfile")
  })
})
