import { Predicate } from "effect"
import { describe, expect, it } from "vitest"
import type { Dockerfile, Instruction, Stage } from "../ir/DockerfileIR"
import { FromOf, HealthOf, Instr, PlatformOf } from "../ir/DockerfileIR"
import { render } from "./Renderer"

const baseFrom = (base: string | { image: string; tag: string } | undefined): Stage["from"] =>
  base === undefined
    ? FromOf.FromStage({ stage: "base" })
    : FromOf.FromImage(Predicate.isString(base) ? { image: base, tag: "latest" } : base)

const stage = (
  name: string,
  instructions: ReadonlyArray<Instruction>,
  base?: string | { image: string; tag: string }
): Stage => ({ name, from: baseFrom(base), instructions })

const df = (stages: ReadonlyArray<Stage>): Dockerfile => ({ stages })

describe("Renderer per-instruction snapshots", () => {
  it("emits FROM image:tag AS name", () => {
    const out = render(df([stage("base", [], { image: "oven/bun", tag: "1.3.5-alpine" })]))
    expect(out).toBe("FROM oven/bun:1.3.5-alpine AS base\n")
  })

  it("emits FROM stage AS name for FromStage", () => {
    const out = render(df([stage("runner", [])]))
    expect(out).toBe("FROM base AS runner\n")
  })

  it("emits FROM with --platform flag for single platform", () => {
    const s: Stage = {
      name: "base",
      from: FromOf.FromImage({ image: "alpine", tag: "3.20" }),
      platform: PlatformOf.Single({ value: "linux/amd64" }),
      instructions: []
    }

    expect(render(df([s]))).toBe("FROM --platform=linux/amd64 alpine:3.20 AS base\n")
  })

  it("emits Copy with flags", () => {
    const i: Instruction = Instr.Copy({
      from: "deps",
      chown: "bunjs:bunjs",
      src: ["src/a", "src/b"],
      dst: "dst/"
    })

    expect(render(df([stage("x", [i])]))).toBe(
      "FROM base AS x\nCOPY --from=deps --chown=bunjs:bunjs src/a src/b dst/\n"
    )
  })

  it("emits Copy without optional flags", () => {
    const i: Instruction = Instr.Copy({ src: ["src"], dst: "dst" })
    expect(render(df([stage("x", [i])]))).toContain("\nCOPY src dst")
  })

  it("emits Run", () => {
    expect(render(df([stage("x", [Instr.Run({ cmd: "bun install" })])]))).toContain(
      "\nRUN bun install"
    )
  })

  it("emits Env multi-pair", () => {
    const i: Instruction = Instr.Env({
      entries: [
        ["NODE_ENV", "production"],
        ["PORT", "4000"]
      ]
    })

    expect(render(df([stage("x", [i])]))).toContain("\nENV NODE_ENV=production PORT=4000")
  })

  it("quotes env values containing spaces", () => {
    const i: Instruction = Instr.Env({ entries: [["MSG", "hello world"]] })
    expect(render(df([stage("x", [i])]))).toContain(`\nENV MSG="hello world"`)
  })

  it("emits Expose with port", () => {
    expect(render(df([stage("x", [Instr.Expose({ port: 4000 })])]))).toContain(
      "\nEXPOSE 4000"
    )
  })

  it("emits User", () => {
    expect(render(df([stage("x", [Instr.User({ user: "bunjs" })])]))).toContain(
      "\nUSER bunjs"
    )
  })

  it("emits Workdir", () => {
    expect(render(df([stage("x", [Instr.Workdir({ path: "/app" })])]))).toContain(
      "\nWORKDIR /app"
    )
  })

  it("emits Cmd in exec form (JSON array)", () => {
    expect(render(df([stage("x", [Instr.Cmd({ argv: ["bun", "main.ts"] })])]))).toContain(
      `\nCMD ["bun","main.ts"]`
    )
  })

  it("emits Entrypoint in exec form", () => {
    expect(
      render(df([stage("x", [Instr.Entrypoint({ argv: ["/sbin/init"] })])]))
    ).toContain(`\nENTRYPOINT ["/sbin/init"]`)
  })

  it("emits Healthcheck CMD with flags", () => {
    const out = render(
      df([
        stage("x", [
          Instr.Healthcheck({
            check: HealthOf.Cmd({
              argv: ["curl", "-f", "http://localhost:4000/health"],
              interval: "30s",
              timeout: "10s",
              retries: 3,
              startPeriod: "5s"
            })
          })
        ])
      ])
    )

    expect(out).toContain(
      `\nHEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=5s CMD ["curl","-f","http://localhost:4000/health"]`
    )
  })

  it("inserts stage-level WORKDIR before instructions", () => {
    const s: Stage = {
      name: "x",
      from: FromOf.FromStage({ stage: "base" }),
      workdir: "/app",
      instructions: [Instr.Run({ cmd: "ls" })]
    }

    expect(render(df([s]))).toBe("FROM base AS x\nWORKDIR /app\nRUN ls\n")
  })

  it("separates multiple stages with blank lines", () => {
    const a = stage("a", [Instr.Run({ cmd: "echo a" })], "alpine")
    const b = stage("b", [Instr.Run({ cmd: "echo b" })])
    expect(render(df([a, b]))).toBe(
      "FROM alpine:latest AS a\nRUN echo a\n\nFROM base AS b\nRUN echo b\n"
    )
  })
})
