import { describe, expect, it } from "vitest"
import { ProdInstall } from "../PackageManager"
import { yarn } from "./yarn"

const targetedCommand = (variant: "classic" | "berry"): ReadonlyArray<string> => {
  return ProdInstall.$match(yarn({ variant }).prodInstall, {
    Targeted: ({ command }) => command("@x/app"),
    Rewrite: ({ command }) => command
  })
}

describe("yarn", () => {
  it("classic: disables lifecycle scripts via --ignore-scripts", () => {
    const pm = yarn({ variant: "classic" })
    expect(pm.installCommand).toContain("--ignore-scripts")
    expect(targetedCommand("classic")).toContain("--ignore-scripts")
  })

  it("berry: disables lifecycle scripts via YARN_ENABLE_SCRIPTS=false (no --ignore-scripts flag exists)", () => {
    const pm = yarn({ variant: "berry" })
    expect(pm.installCommand[0]).toBe("YARN_ENABLE_SCRIPTS=false")
    expect(targetedCommand("berry")[0]).toBe("YARN_ENABLE_SCRIPTS=false")
  })

  it("berry: prod install focuses the target workspace without dev dependencies", () => {
    expect(targetedCommand("berry").join(" ")).toBe(
      "YARN_ENABLE_SCRIPTS=false yarn workspaces focus --production @x/app"
    )
  })
})
