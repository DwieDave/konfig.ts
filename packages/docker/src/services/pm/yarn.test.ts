import { describe, expect, it } from "vitest"
import { yarn } from "./yarn"

describe("yarn", () => {
  it("classic: disables lifecycle scripts via --ignore-scripts", () => {
    const pm = yarn({ variant: "classic" })
    expect(pm.installCommand).toContain("--ignore-scripts")
    expect(pm.prodInstallCommand).toContain("--ignore-scripts")
  })

  it("berry: disables lifecycle scripts via YARN_ENABLE_SCRIPTS=false (no --ignore-scripts flag exists)", () => {
    const pm = yarn({ variant: "berry" })
    expect(pm.installCommand[0]).toBe("YARN_ENABLE_SCRIPTS=false")
    expect(pm.prodInstallCommand[0]).toBe("YARN_ENABLE_SCRIPTS=false")
  })
})
