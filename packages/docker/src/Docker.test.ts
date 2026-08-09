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

describe("Docker.runtime constructors", () => {
  it("Docker.runtime.bun() omits alpine when unset", () => {
    expect(Docker.runtime.bun()).toEqual({ _tag: "BunRuntime" })
    expect("alpine" in Docker.runtime.bun()).toBe(false)
  })

  it("Docker.runtime.bun({ alpine: true }) carries the flag", () => {
    expect(Docker.runtime.bun({ alpine: true })).toEqual({ _tag: "BunRuntime", alpine: true })
  })

  it("Docker.runtime.node() omits alpine when unset, carries it when set", () => {
    expect(Docker.runtime.node()).toEqual({ _tag: "NodeRuntime" })
    expect(Docker.runtime.node({ alpine: false })).toEqual({ _tag: "NodeRuntime", alpine: false })
  })
})

describe("Docker.build constructors", () => {
  it("Docker.build.script produces a BuildScript atom", () => {
    expect(Docker.build.script("bun run build")).toEqual({
      _tag: "BuildScript",
      script: "bun run build"
    })
  })

  it("Docker.build.command produces a BuildCommand atom with the argv", () => {
    expect(Docker.build.command(["bun", "build", "."])).toEqual({
      _tag: "BuildCommand",
      argv: ["bun", "build", "."]
    })
  })

  it("Docker.build.none produces a BuildNone atom", () => {
    expect(Docker.build.none()).toEqual({ _tag: "BuildNone" })
  })
})

describe("Docker.copy constructors", () => {
  it("Docker.copy.builderArtifact carries src/dst and omits chown when unset", () => {
    const atom = Docker.copy.builderArtifact({ src: "/build/dist", dst: "/app/dist" })
    expect(atom).toEqual({ _tag: "BuilderArtifact", src: "/build/dist", dst: "/app/dist" })
    expect("chown" in atom).toBe(false)
  })

  it("Docker.copy.builderArtifact includes chown when set", () => {
    expect(Docker.copy.builderArtifact({ src: "/build/dist", dst: "/app/dist", chown: "node:node" })).toEqual({
      _tag: "BuilderArtifact",
      src: "/build/dist",
      dst: "/app/dist",
      chown: "node:node"
    })
  })

  it("Docker.copy.workspaceSource carries the workspace name", () => {
    expect(Docker.copy.workspaceSource("apps/api")).toEqual({
      _tag: "WorkspaceSource",
      name: "apps/api"
    })
  })

  it("Docker.copy.workspaceSourceAll produces a WorkspaceSourceAll atom", () => {
    expect(Docker.copy.workspaceSourceAll()).toEqual({ _tag: "WorkspaceSourceAll" })
  })

  it("Docker.copy.path omits from/chown when unset", () => {
    const atom = Docker.copy.path({ src: "package.json", dst: "package.json" })
    expect(atom).toEqual({ _tag: "CopyPath", src: "package.json", dst: "package.json" })
    expect("from" in atom).toBe(false)
    expect("chown" in atom).toBe(false)
  })

  it("Docker.copy.path includes from/chown when set", () => {
    expect(
      Docker.copy.path({ src: "package.json", dst: "package.json", from: "builder", chown: "app:app" })
    ).toEqual({
      _tag: "CopyPath",
      src: "package.json",
      dst: "package.json",
      from: "builder",
      chown: "app:app"
    })
  })
})

describe("Docker.healthcheck constructors", () => {
  it("Docker.healthcheck.httpGet carries only the provided fields", () => {
    const atom = Docker.healthcheck.httpGet({ path: "/healthz", port: 3000 })
    expect(atom).toEqual({ _tag: "HealthcheckHttpGet", path: "/healthz", port: 3000 })
    expect("interval" in atom).toBe(false)
    expect("retries" in atom).toBe(false)
  })

  it("Docker.healthcheck.httpGet carries interval/timeout/retries/startPeriod when set", () => {
    expect(
      Docker.healthcheck.httpGet({
        path: "/healthz",
        port: 3000,
        interval: "10s",
        timeout: "2s",
        retries: 3,
        startPeriod: "5s"
      })
    ).toEqual({
      _tag: "HealthcheckHttpGet",
      path: "/healthz",
      port: 3000,
      interval: "10s",
      timeout: "2s",
      retries: 3,
      startPeriod: "5s"
    })
  })

  it("Docker.healthcheck.command carries the argv and omits unset optionals", () => {
    const atom = Docker.healthcheck.command({ argv: ["curl", "-f", "localhost"] })
    expect(atom).toEqual({ _tag: "HealthcheckCommand", argv: ["curl", "-f", "localhost"] })
    expect("retries" in atom).toBe(false)
  })

  it("Docker.healthcheck.command carries retries when set", () => {
    expect(Docker.healthcheck.command({ argv: ["curl", "-f", "localhost"], retries: 5 })).toEqual({
      _tag: "HealthcheckCommand",
      argv: ["curl", "-f", "localhost"],
      retries: 5
    })
  })
})

describe("Docker.user constructors", () => {
  it("Docker.user.nonRoot() omits uid/gid/name when unset", () => {
    const atom = Docker.user.nonRoot()
    expect(atom).toEqual({ _tag: "UserNonRoot" })
    expect("uid" in atom).toBe(false)
  })

  it("Docker.user.nonRoot carries uid/gid/name when set", () => {
    expect(Docker.user.nonRoot({ uid: 1000, gid: 1000, name: "app" })).toEqual({
      _tag: "UserNonRoot",
      uid: 1000,
      gid: 1000,
      name: "app"
    })
  })

  it("Docker.user.root produces a UserRoot atom", () => {
    expect(Docker.user.root()).toEqual({ _tag: "UserRoot" })
  })
})

describe("Docker.platform constructors", () => {
  it("Docker.platform.linuxAmd64 produces a PlatformLinuxAmd64 atom", () => {
    expect(Docker.platform.linuxAmd64()).toEqual({ _tag: "PlatformLinuxAmd64" })
  })

  it("Docker.platform.linuxArm64 produces a PlatformLinuxArm64 atom", () => {
    expect(Docker.platform.linuxArm64()).toEqual({ _tag: "PlatformLinuxArm64" })
  })

  it("Docker.platform.multi carries the values array", () => {
    expect(Docker.platform.multi(["linux/amd64", "linux/arm64"])).toEqual({
      _tag: "PlatformMulti",
      values: ["linux/amd64", "linux/arm64"]
    })
  })
})

describe("Docker.app", () => {
  it("wraps the given spec as a branded DockerApp exposing the same spec", () => {
    const app = Docker.app(sampleSpec)
    expect(isDockerApp(app)).toBe(true)
    expect(app.spec).toBe(sampleSpec)
  })
})
