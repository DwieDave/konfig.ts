import { describe, expect, it } from "vitest"
import { PKG_SCRIPTS, pkgSteps } from "./pkg"

describe("pkgSteps", () => {
  const layout = { entry: "./src/index.ts", hasBuildTsconfig: true }

  it("yields at least one non-empty argv for every script", () => {
    PKG_SCRIPTS.forEach((script) => {
      const steps = pkgSteps({ script, layout })
      expect(steps.length).toBeGreaterThan(0)
      steps.forEach((argv) => expect(argv.length).toBeGreaterThan(0))
    })
  })

  it("builds the layout's entry and finishes with tsc or chmod", () => {
    const [bundle, tail] = pkgSteps({ script: "build", layout })
    expect(bundle).toContain("./src/index.ts")
    expect(tail?.slice(0, 2)).toEqual(["bunx", "tsc"])
    const cli = pkgSteps({ script: "build", layout: { entry: "./src/main.ts", hasBuildTsconfig: false } })
    expect(cli[1]?.[0]).toBe("chmod")
  })
})
