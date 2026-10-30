import { describe, expect, it } from "vitest"
import * as Core from "./index"
// @ts-expect-error PvcRefName is not part of the barrel
import type { PvcRefName } from "./index"

describe("core barrel", () => {
  it.each(["render", "parseYaml", "ProcessInvocationError"])("does not export %s", (name) => {
    expect(name in Core).toBe(false)
  })

  it.each(["existsOrFalse", "readOrEmpty", "findUp", "sha256Hex"])("exports %s", (name) => {
    expect(name in Core).toBe(true)
  })

  it("does not export the PvcRefName type", () => {
    const probe: PvcRefName<string> = "x"
    expect(probe).toBe("x")
  })
})
