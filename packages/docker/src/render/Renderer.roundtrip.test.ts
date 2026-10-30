import { Effect, Schema } from "effect"
import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import type { Dockerfile, Instruction, Stage } from "../ir/DockerfileIR"
import { FromOf, HealthOf, Instr } from "../ir/DockerfileIR"
import { render } from "./Renderer"

const decodeArgv = Schema.decodeEffect(Schema.fromJsonString(Schema.Array(Schema.String)))

const parseArgv = (json: string): ReadonlyArray<string> => Effect.runSync(decodeArgv(json))

const flagValue = (flags: ReadonlyArray<string>, name: string): string | undefined =>
  flags.find((f) => f.startsWith(`--${name}=`))?.slice(name.length + 3)

const parseFrom = (line: string): Stage => {
  const m = line.match(/^FROM (\S+) AS (\S+)$/)

  if (!m) throw new Error(`bad FROM: ${line}`)

  const ref = m[1] ?? ""
  const colonIdx = ref.indexOf(":")

  const from = colonIdx < 0
    ? FromOf.FromStage({ stage: ref })
    : FromOf.FromImage({ image: ref.slice(0, colonIdx), tag: ref.slice(colonIdx + 1) })

  return { name: m[2] ?? "", from, instructions: [] }
}

const parseCopy = (body: string): Instruction => {
  const tokens = body.split(" ")
  const flags = tokens.filter((t) => t.startsWith("--"))
  const rest = tokens.filter((t) => !t.startsWith("--"))

  if (rest.length < 2) throw new Error(`bad COPY: ${body}`)

  return Instr.Copy({
    src: rest.slice(0, -1),
    dst: rest[rest.length - 1] ?? "",
    from: flagValue(flags, "from"),
    chown: flagValue(flags, "chown")
  })
}

const parseEnvPair = (pair: string): ReadonlyArray<readonly [string, string]> => {
  const m = pair.match(/^([^=]*)=(.*)$/)

  return m ? [[m[1] ?? "", m[2] ?? ""]] : []
}

const parseEnv = (body: string): Instruction => Instr.Env({ entries: body.split(" ").flatMap(parseEnvPair) })

const parseHealthcheck = (body: string): Instruction => {
  const m = body.match(/^(?:(.*?) )?CMD (.*)$/)

  if (!m) throw new Error(`bad HEALTHCHECK: ${body}`)
  const flags = (m[1] ?? "").split(" ")
  const retries = flagValue(flags, "retries")

  return Instr.Healthcheck({
    check: HealthOf.Cmd({
      argv: parseArgv(m[2] ?? ""),
      interval: flagValue(flags, "interval"),
      timeout: flagValue(flags, "timeout"),
      retries: retries === undefined ? undefined : Number(retries),
      startPeriod: flagValue(flags, "start-period")
    })
  })
}

const instructionParsers: ReadonlyArray<readonly [string, (body: string) => Instruction]> = [
  ["COPY ", parseCopy],
  ["RUN ", (cmd) => Instr.Run({ cmd })],
  ["ENV ", parseEnv],
  ["EXPOSE ", (body) => Instr.Expose({ port: Number(body) })],
  ["USER ", (user) => Instr.User({ user })],
  ["WORKDIR ", (path) => Instr.Workdir({ path })],
  ["CMD ", (body) => Instr.Cmd({ argv: parseArgv(body) })],
  ["ENTRYPOINT ", (body) => Instr.Entrypoint({ argv: parseArgv(body) })],
  ["HEALTHCHECK ", parseHealthcheck]
]

const parseInstruction = (line: string): Instruction => {
  const hit = instructionParsers.find(([prefix]) => line.startsWith(prefix))

  if (!hit) throw new Error(`unknown instruction: ${line}`)

  return hit[1](line.slice(hit[0].length))
}

const appendLine = (stages: ReadonlyArray<Stage>, line: string): ReadonlyArray<Stage> => {
  if (line.startsWith("FROM ")) return [...stages, parseFrom(line)]
  const last = stages.at(-1)

  if (!last) throw new Error("instruction before any FROM")

  const isStageWorkdir = line.startsWith("WORKDIR ") && last.workdir === undefined && last.instructions.length === 0

  const updated: Stage = isStageWorkdir
    ? { ...last, workdir: line.slice("WORKDIR ".length) }
    : { ...last, instructions: [...last.instructions, parseInstruction(line)] }

  return [...stages.slice(0, -1), updated]
}

const parseDockerfile = (text: string): Dockerfile => ({
  stages: text
    .split("\n")
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .reduce<ReadonlyArray<Stage>>(appendLine, [])
})

const idChar = fc.constantFrom(
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "0",
  "1",
  "2",
  "3"
)

const safeStr = fc.array(idChar, { minLength: 3, maxLength: 6 }).map((cs) => cs.join(""))

const upperChar = fc.constantFrom("A", "B", "C", "D", "E")
const envChar = fc.constantFrom("A", "B", "0", "1", "_")

const safeEnvKey = fc
  .tuple(upperChar, fc.array(envChar, { minLength: 0, maxLength: 4 }))
  .map(([h, t]) => `${h}${t.join("")}`)

const envValChar = fc.constantFrom("a", "b", "0", "1", ".", "-")
const safeEnvVal = fc.array(envValChar, { minLength: 1, maxLength: 6 }).map((cs) => cs.join(""))

const port = fc.integer({ min: 1, max: 65535 })
const duration = fc.constantFrom("5s", "10s", "30s")

const fromImage = fc.record({ image: safeStr, tag: safeStr }).map(FromOf.FromImage)

const copyArb: fc.Arbitrary<Instruction> = fc
  .tuple(
    fc.option(safeStr, { nil: undefined }),
    fc.array(safeStr, { minLength: 1, maxLength: 3 }),
    safeStr
  )
  .map(([from, src, dst]) => Instr.Copy({ src, dst, from }))

const envArb: fc.Arbitrary<Instruction> = fc
  .array(fc.tuple(safeEnvKey, safeEnvVal), { minLength: 1, maxLength: 3 })
  .map((entries) => Instr.Env({ entries }))

const exposeArb: fc.Arbitrary<Instruction> = port.map((p) => Instr.Expose({ port: p }))

const argvArb = fc.array(safeStr, { minLength: 1, maxLength: 3 })

const healthArb: fc.Arbitrary<Instruction> = fc
  .tuple(
    argvArb,
    fc.option(duration, { nil: undefined }),
    fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined })
  )
  .map(([argv, interval, retries]) => Instr.Healthcheck({ check: HealthOf.Cmd({ argv, interval, retries }) }))

const instructionArb: fc.Arbitrary<Instruction> = fc.oneof(
  copyArb,
  safeStr.map((s) => Instr.Run({ cmd: `cmd-${s}` })),
  envArb,
  exposeArb,
  safeStr.map((user) => Instr.User({ user })),
  safeStr.map((p) => Instr.Workdir({ path: `/${p}` })),
  argvArb.map((argv) => Instr.Cmd({ argv })),
  argvArb.map((argv) => Instr.Entrypoint({ argv })),
  healthArb
)

const stageArb: fc.Arbitrary<Stage> = fc
  .record({
    name: safeStr,
    from: fromImage,
    workdir: fc.option(safeStr.map((p) => `/${p}`), { nil: undefined }),
    instructions: fc.array(instructionArb, { minLength: 0, maxLength: 4 })
  })
  .map((s): Stage => ({ name: s.name, from: s.from, workdir: s.workdir, instructions: s.instructions }))

const dockerfileArb: fc.Arbitrary<Dockerfile> = fc
  .array(stageArb, { minLength: 1, maxLength: 3 })
  .map((stages): Dockerfile => ({ stages: stages.map((s, i) => ({ ...s, name: `${s.name}-${i}` })) }))

describe("Renderer round-trip", () => {
  it("render→parse→render is fixed-point", () => {
    fc.assert(
      fc.property(dockerfileArb, (df) => {
        const first = render(df)
        const reparsed = parseDockerfile(first)
        const second = render(reparsed)
        expect(second).toBe(first)
      }),
      { numRuns: 40 }
    )
  })

  it("render is deterministic", () => {
    fc.assert(
      fc.property(dockerfileArb, (df) => {
        expect(render(df)).toBe(render(df))
      }),
      { numRuns: 30 }
    )
  })
})
