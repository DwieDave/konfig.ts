import { describe, expect, it } from "vitest"
import type { PackageInfo } from "../lib/repo"
import { planCoverage, planScript, SCRIPTS_RUN } from "./packageScript"

const _pkg = (input: { readonly name: string; readonly scripts: ReadonlyArray<string> }): PackageInfo => ({
  dir: `/repo/packages/${input.name}`,
  name: `@konfig.ts/${input.name}`,
  isPrivate: false,
  scripts: new Set(input.scripts),
  deps: new Set()
})

const _pkgs = [
  _pkg({ name: "core", scripts: ["test:coverage", "build"] }),
  _pkg({ name: "oxc", scripts: ["test", "test:coverage"] }),
  _pkg({ name: "docs", scripts: ["build"] })
]

describe("planCoverage", () => {
  it("includes oxc and ends with the scripts pseudo-package", () => {
    const plan = planCoverage(_pkgs)
    expect(plan.map((r) => r.name)).toContain("@konfig.ts/oxc test:coverage")
    expect(plan.at(-1)).toEqual(SCRIPTS_RUN)
  })

  it("skips packages lacking the script", () => {
    expect(planScript({ pkgs: _pkgs, script: "build" }).map((r) => r.name)).not.toContain("@konfig.ts/oxc build")
  })
})
