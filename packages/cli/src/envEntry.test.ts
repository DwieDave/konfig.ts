import { describe, expect, it } from "@effect/vitest"
import { unsafeCoerce } from "@konfig.ts/core"
import { envEntryPath } from "./envEntry"

const join = (...p: string[]) => p.join("/")

const cfg = unsafeCoerce<Parameters<typeof envEntryPath>[0]["cfg"]>({
  configDir: "/c",
  config: { root: "r", envs: { prod: { entry: "x/prod.ts" } } }
}, "minimal config fixture")

describe("envEntryPath", () => {
  it("uses the declared entry", () => {
    expect(envEntryPath({ cfg, envName: "prod", pathJoin: join })).toBe("/c/r/x/prod.ts")
  })
  it("falls back to env/<name>.ts", () => {
    expect(envEntryPath({ cfg, envName: "dev", pathJoin: join })).toBe("/c/r/env/dev.ts")
  })
})
