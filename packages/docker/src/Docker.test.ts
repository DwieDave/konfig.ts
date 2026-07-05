import { describe, expect, it } from "vitest"
import { Docker, DockerAppTypeId, isDockerApp, makeDockerApp } from "./Docker"
import type { DockerSpec } from "./spec"

const sampleSpec: DockerSpec = {
  target: "apps/x",
  runner: {
    workdir: "/app",
    copy: [],
    cmd: ["bun", "run", "main.ts"]
  }
}

describe("Docker brand", () => {
  it("makeDockerApp produces an object carrying the brand symbol", () => {
    const app = makeDockerApp(sampleSpec)
    expect(DockerAppTypeId in app).toBe(true)
    expect(app.spec).toBe(sampleSpec)
  })

  it("isDockerApp accepts a branded value", () => {
    const app = makeDockerApp(sampleSpec)
    expect(isDockerApp(app)).toBe(true)
  })

  it("isDockerApp rejects a plain spec object", () => {
    expect(isDockerApp(sampleSpec)).toBe(false)
  })

  it("isDockerApp rejects null, undefined, and primitives", () => {
    expect(isDockerApp(null)).toBe(false)
    expect(isDockerApp(undefined)).toBe(false)
    expect(isDockerApp("docker")).toBe(false)
    expect(isDockerApp(42)).toBe(false)
  })

  it("isDockerApp rejects an object that merely has a spec field", () => {
    expect(isDockerApp({ spec: sampleSpec })).toBe(false)
  })
})

describe("Docker.pm constructors", () => {
  it("exposes bun/npm/pnpm/yarn matching the supported PackageManagerAtom union", () => {
    expect(Docker.pm.bun()).toEqual({ _tag: "BunPm" })
    expect(Docker.pm.npm()).toEqual({ _tag: "NpmPm" })
    expect(Docker.pm.pnpm()).toEqual({ _tag: "PnpmPm" })
    expect(Docker.pm.yarn()).toEqual({ _tag: "YarnPm" })
  })

  it("Docker.pm.yarn accepts a classic/berry variant", () => {
    expect(Docker.pm.yarn({ variant: "classic" })).toEqual({
      _tag: "YarnPm",
      variant: "classic"
    })
    expect(Docker.pm.yarn({ variant: "berry" })).toEqual({
      _tag: "YarnPm",
      variant: "berry"
    })
  })

  it("Docker.pm.yarn() omits the variant key when unset", () => {
    expect("variant" in Docker.pm.yarn()).toBe(false)
  })
})
