import { describe, expect, it } from "vitest"
import { type Dockerfile, FromOf, HealthOf, Instr, type Instruction, type Stage } from "./DockerfileIR"

describe("DockerfileIR", () => {
  it("constructs a minimal Dockerfile with one stage and one instruction", () => {
    const instr: Instruction = Instr.Run({ cmd: "echo hello" })

    const stage: Stage = {
      name: "base",
      from: FromOf.FromImage({ image: "alpine", tag: "3.20" }),
      instructions: [instr]
    }

    const df: Dockerfile = { stages: [stage] }

    expect(df.stages).toHaveLength(1)
    expect(df.stages[0]?.name).toBe("base")
    expect(Instr.$is("Run")(df.stages[0]?.instructions[0])).toBe(true)
  })

  it("narrows Instruction union by _tag", () => {
    const i: Instruction = Instr.Expose({ port: 4000 })

    if (Instr.$is("Expose")(i)) {
      expect(i.port).toBe(4000)
    } else {
      throw new Error("expected Expose")
    }
  })

  it("supports FromStage references", () => {
    const stage: Stage = {
      name: "runner",
      from: FromOf.FromStage({ stage: "base" }),
      instructions: []
    }

    expect(FromOf.$is("FromStage")(stage.from)).toBe(true)
  })

  it("supports Healthcheck nested IR", () => {
    const i: Instruction = Instr.Healthcheck({
      check: HealthOf.Cmd({
        argv: ["curl", "-f", "http://localhost:4000/health"],
        interval: "30s",
        retries: 3
      })
    })

    if (Instr.$is("Healthcheck")(i) && HealthOf.$is("Cmd")(i.check)) {
      expect(i.check.argv).toHaveLength(3)
    } else {
      throw new Error("expected Healthcheck.Cmd")
    }
  })
})
