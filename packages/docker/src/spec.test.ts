import { Effect, Exit, Schema } from "effect"
import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import {
  BuildAtom,
  CopyAtom,
  decodeDockerSpec,
  type DockerSpec,
  EngineVersion,
  HealthcheckAtom,
  PackageManagerAtom,
  PlatformAtom,
  RuntimeAtom,
  UserAtom
} from "./spec"

const minimalValid = {
  runner: {
    workdir: "/app/apps/kanban/server",
    copy: [CopyAtom.cases.BuilderArtifact.make({ src: "dist", dst: "dist" })],
    cmd: ["bun", "run", "dist/main.js"]
  }
} as const

const fullValid = {
  packageManager: PackageManagerAtom.cases.BunPm.make({}),
  runtime: RuntimeAtom.cases.BunRuntime.make({ alpine: true }),
  build: BuildAtom.cases.BuildScript.make({ script: "build" }),
  sharedRootFiles: ["tsconfig.base.json"],
  runner: {
    workdir: "/app",
    copy: [
      CopyAtom.cases.BuilderArtifact.make({ src: "dist", dst: "dist" }),
      CopyAtom.cases.WorkspaceSource.make({ name: "@konfig.ts/core" }),
      CopyAtom.cases.WorkspaceSourceAll.make({}),
      CopyAtom.cases.CopyPath.make({ src: "/etc/x", dst: "/etc/x" })
    ],
    env: { NODE_ENV: "production", PORT: "4000" },
    expose: 4000,
    cmd: ["bun", "run", "dist/main.js"],
    user: UserAtom.cases.UserNonRoot.make({ uid: 1001, name: "bunjs" }),
    healthcheck: HealthcheckAtom.cases.HealthcheckHttpGet.make({
      path: "/healthz",
      port: 4000,
      interval: "30s",
      retries: 3
    }),
    platform: PlatformAtom.cases.PlatformLinuxAmd64.make({})
  },
  dev: {
    cmd: ["bun", "--watch", "main.ts"],
    env: { NODE_ENV: "development" },
    expose: [4000, 9229]
  }
} as const

describe("DockerSpec Schema", () => {
  it("decodes a minimal valid spec", () => {
    const exit = Effect.runSyncExit(decodeDockerSpec(minimalValid))
    expect(Exit.isSuccess(exit)).toBe(true)

    if (Exit.isSuccess(exit)) {
      const decoded: DockerSpec = exit.value
      expect(decoded.runner.workdir).toBe("/app/apps/kanban/server")
      expect(decoded.runner.cmd).toEqual(["bun", "run", "dist/main.js"])
    }
  })

  it("decodes a fully-populated spec with every atom family", () => {
    const exit = Effect.runSyncExit(decodeDockerSpec(fullValid))
    expect(Exit.isSuccess(exit)).toBe(true)

    if (Exit.isSuccess(exit)) {
      const d = exit.value
      expect(d.runner.copy).toHaveLength(4)
      expect(d.runner.user?._tag).toBe("UserNonRoot")
      expect(d.runner.healthcheck?._tag).toBe("HealthcheckHttpGet")
      expect(d.dev?.cmd).toEqual(["bun", "--watch", "main.ts"])
    }
  })

  it("rejects a spec missing required runner.cmd", () => {
    const exit = Effect.runSyncExit(
      decodeDockerSpec({
        runner: { workdir: "/x", copy: [] }
      })
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("rejects an env value that looks like a secret (sk_ prefix)", () => {
    const exit = Effect.runSyncExit(
      decodeDockerSpec({
        ...minimalValid,
        runner: { ...minimalValid.runner, env: { STRIPE_KEY: "sk_live_abcdef0123456789ab" } }
      })
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("rejects an env value that looks like a base64 secret", () => {
    const exit = Effect.runSyncExit(
      decodeDockerSpec({
        ...minimalValid,
        runner: {
          ...minimalValid.runner,
          env: { TOKEN: "AAAAB3NzaC1yc2EAAAADAQABAAABAQDFooBar1234567890" }
        }
      })
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("accepts a 40-char hex git SHA (GIT_SHA) — not a secret", () => {
    const exit = Effect.runSyncExit(
      decodeDockerSpec({
        ...minimalValid,
        runner: {
          ...minimalValid.runner,
          env: { GIT_SHA: "5f2e3a1b9c8d7e6f4a3b2c1d0e9f8a7b6c5d4e3f" }
        }
      })
    )

    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("accepts a 64-char hex digest (SENTRY_RELEASE) — not a secret", () => {
    const exit = Effect.runSyncExit(
      decodeDockerSpec({
        ...minimalValid,
        runner: {
          ...minimalValid.runner,
          env: {
            SENTRY_RELEASE: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
          }
        }
      })
    )

    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("still flags a mixed-class base64 secret (upper+lower+digit)", () => {
    const exit = Effect.runSyncExit(
      decodeDockerSpec({
        ...minimalValid,
        runner: {
          ...minimalValid.runner,
          env: { API_KEY: "QWxwaGFCZXRhR2FtbWE5ODc2NTQzMjEwWFlaTG9yZW1JcHN1bQ" }
        }
      })
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("still flags a base64 value containing special chars (+ / =)", () => {
    const exit = Effect.runSyncExit(
      decodeDockerSpec({
        ...minimalValid,
        runner: {
          ...minimalValid.runner,
          env: { KEY: "dGhpcytpcy9hL3NlY3JldC92YWx1ZS93aXRoK3NwZWNpYWxz==" }
        }
      })
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("accepts a normal env value", () => {
    const exit = Effect.runSyncExit(
      decodeDockerSpec({
        ...minimalValid,
        runner: { ...minimalValid.runner, env: { NODE_ENV: "production", PORT: "4000" } }
      })
    )

    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("rejects an out-of-range port", () => {
    const exit = Effect.runSyncExit(
      decodeDockerSpec({
        ...minimalValid,
        runner: { ...minimalValid.runner, expose: 99999 }
      })
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  const decodesEnv = (value: string): boolean =>
    Exit.isSuccess(
      Effect.runSyncExit(
        decodeDockerSpec({ ...minimalValid, runner: { ...minimalValid.runner, env: { VALUE: value } } })
      )
    )

  it("never flags locale strings as secrets", () => {
    const locale = fc.tuple(fc.stringMatching(/^[a-z]{2}$/), fc.stringMatching(/^[A-Z]{2}$/)).map(([l, c]) =>
      `${l}_${c}.UTF-8`
    )

    fc.assert(fc.property(locale, decodesEnv))
    expect(decodesEnv("sk_SK.UTF-8")).toBe(true)
  })

  it("never flags absolute paths as secrets", () => {
    const segment = fc.stringMatching(/^[A-Za-z0-9._-]{1,20}$/)
    const absPath = fc.array(segment, { minLength: 1, maxLength: 12 }).map((parts) => `/${parts.join("/")}`)

    fc.assert(fc.property(absPath, decodesEnv))
  })

  it("rejects an http healthcheck path that does not start with a slash", () => {
    const decodeWithPath = (path: string) =>
      Effect.runSyncExit(
        decodeDockerSpec({
          ...minimalValid,
          runner: {
            ...minimalValid.runner,
            healthcheck: { ...HealthcheckAtom.cases.HealthcheckHttpGet.make({ path: "/x", port: 80 }), path }
          }
        })
      )

    expect(Exit.isFailure(decodeWithPath("healthz"))).toBe(true)
    expect(Exit.isSuccess(decodeWithPath("/healthz"))).toBe(true)
  })
})

describe("EngineVersion", () => {
  const DOCKER_TAG_RE = /^\w[\w.-]{0,127}$/
  const accepts = Schema.is(EngineVersion)

  it("accepts only values that are valid Docker tags", () => {
    fc.assert(fc.property(fc.string(), (s) => !accepts(s) || DOCKER_TAG_RE.test(s)))
    fc.assert(fc.property(fc.stringMatching(/^\d{1,3}(\.\d{1,3}){0,2}$/), accepts))
  })

  it("rejects ranges", () => {
    for (const range of [">=22", "^22.1.0", "22.x", "~1.2", "22 || 24", "latest", ""]) {
      expect(accepts(range)).toBe(false)
    }
  })
})
