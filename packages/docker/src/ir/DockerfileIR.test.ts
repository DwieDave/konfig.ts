import { describe, expect, it } from "vitest"
import type { Dockerfile, Instruction, Stage } from "./DockerfileIR"

describe("DockerfileIR", () => {
  it("constructs a minimal Dockerfile with one stage and one instruction", () => {
    const instr: Instruction = { _tag: "Run", cmd: "echo hello" }
    const stage: Stage = {
      name: "base",
      from: { _tag: "FromImage", image: "alpine", tag: "3.20" },
      instructions: [instr]
    }
    const df: Dockerfile = { args: [], stages: [stage] }

    expect(df.stages).toHaveLength(1)
    expect(df.stages[0]?.name).toBe("base")
    expect(df.stages[0]?.instructions[0]?._tag).toBe("Run")
  })

  it("narrows Instruction union by _tag", () => {
    const i: Instruction = { _tag: "Expose", port: 4000, protocol: "tcp" }
    if (i._tag === "Expose") {
      expect(i.port).toBe(4000)
    } else {
      throw new Error("expected Expose")
    }
  })

  it("supports FromStage references", () => {
    const stage: Stage = {
      name: "runner",
      from: { _tag: "FromStage", stage: "base" },
      instructions: []
    }
    expect(stage.from._tag).toBe("FromStage")
  })

  it("supports Healthcheck nested IR", () => {
    const i: Instruction = {
      _tag: "Healthcheck",
      check: {
        _tag: "Cmd",
        argv: ["curl", "-f", "http://localhost:4000/health"],
        interval: "30s",
        retries: 3
      }
    }
    if (i._tag === "Healthcheck" && i.check._tag === "Cmd") {
      expect(i.check.argv).toHaveLength(3)
    } else {
      throw new Error("expected Healthcheck.Cmd")
    }
  })
})
