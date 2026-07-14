import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import type { Dockerfile, HealthcheckIR, Instruction, PlatformValue, Stage } from "../ir/DockerfileIR"
import { render } from "./Renderer"

// ───────────────────────── tiny canonical-output parser ────────────────────

const splitFromLine = (line: string): { platform?: PlatformValue; rest: string } => {
  const m = line.match(/^FROM (--platform=(\S+) )?(.+)$/)
  if (!m) throw new Error(`bad FROM: ${line}`)
  const platform = m[2] as PlatformValue | undefined
  return { platform, rest: m[3] ?? "" }
}

const parseFrom = (
  line: string
): { from: Stage["from"]; platform?: Stage["platform"]; name: string } => {
  const { platform, rest } = splitFromLine(line)
  const m = rest.match(/^(\S+) AS (\S+)$/)
  if (!m) throw new Error(`bad FROM payload: ${rest}`)
  const ref = m[1] ?? ""
  const name = m[2] ?? ""
  const platformIR = platform ? ({ _tag: "Single", value: platform } as const) : undefined
  if (ref.includes(":")) {
    const colonIdx = ref.indexOf(":")
    return {
      from: { _tag: "FromImage", image: ref.slice(0, colonIdx), tag: ref.slice(colonIdx + 1) },
      platform: platformIR,
      name
    }
  }
  return { from: { _tag: "FromStage", stage: ref }, platform: platformIR, name }
}

const parseCopy = (line: string): Instruction => {
  const tokens = line.slice("COPY ".length).split(" ")
  let from: string | undefined
  let chown: string | undefined
  let i = 0
  while (i < tokens.length && tokens[i]?.startsWith("--")) {
    const t = tokens[i] ?? ""
    if (t.startsWith("--from=")) from = t.slice("--from=".length)
    else if (t.startsWith("--chown=")) chown = t.slice("--chown=".length)
    i++
  }
  const rest = tokens.slice(i)
  if (rest.length < 2) throw new Error(`bad COPY: ${line}`)
  const dst = rest[rest.length - 1] ?? ""
  const src = rest.slice(0, -1)
  return { _tag: "Copy", src, dst, ...(from ? { from } : {}), ...(chown ? { chown } : {}) }
}

const parseEnv = (line: string): Instruction => {
  const body = line.slice("ENV ".length)
  const entries: Array<[string, string]> = []
  for (const pair of body.split(" ")) {
    const eq = pair.indexOf("=")
    if (eq < 0) continue
    entries.push([pair.slice(0, eq), pair.slice(eq + 1)])
  }
  return { _tag: "Env", entries }
}

const parseHealthcheck = (line: string): Instruction => {
  const body = line.slice("HEALTHCHECK ".length)
  if (body === "NONE") return { _tag: "Healthcheck", check: { _tag: "None" } }
  const cmdIdx = body.indexOf(" CMD ")
  const flagsPart = cmdIdx < 0 ? "" : body.slice(0, cmdIdx)
  const cmdPart = cmdIdx < 0 ? body.slice("CMD ".length) : body.slice(cmdIdx + " CMD ".length)
  const argv = JSON.parse(cmdPart) as ReadonlyArray<string>
  const partial: {
    -readonly [K in keyof Extract<HealthcheckIR, { _tag: "Cmd" }>]?: Extract<HealthcheckIR, { _tag: "Cmd" }>[K]
  } = { _tag: "Cmd", argv }
  for (const flag of flagsPart ? flagsPart.split(" ") : []) {
    if (flag.startsWith("--interval=")) partial.interval = flag.slice("--interval=".length)
    else if (flag.startsWith("--timeout=")) partial.timeout = flag.slice("--timeout=".length)
    else if (flag.startsWith("--retries=")) partial.retries = Number(flag.slice("--retries=".length))
    else if (flag.startsWith("--start-period=")) partial.startPeriod = flag.slice("--start-period=".length)
  }
  return { _tag: "Healthcheck", check: partial as Extract<HealthcheckIR, { _tag: "Cmd" }> }
}

const parseInstruction = (line: string): Instruction => {
  if (line.startsWith("COPY ")) return parseCopy(line)
  if (line.startsWith("RUN ")) return { _tag: "Run", cmd: line.slice("RUN ".length) }
  if (line.startsWith("ENV ")) return parseEnv(line)
  if (line.startsWith("EXPOSE ")) {
    const body = line.slice("EXPOSE ".length)
    const [portStr, proto] = body.split("/")
    const ins: Extract<Instruction, { _tag: "Expose" }> = { _tag: "Expose", port: Number(portStr) }
    return proto ? { ...ins, protocol: proto as "tcp" | "udp" } : ins
  }
  if (line.startsWith("USER ")) return { _tag: "User", user: line.slice("USER ".length) }
  if (line.startsWith("WORKDIR ")) return { _tag: "Workdir", path: line.slice("WORKDIR ".length) }
  if (line.startsWith("CMD ")) return { _tag: "Cmd", argv: JSON.parse(line.slice("CMD ".length)) }
  if (line.startsWith("ENTRYPOINT ")) {
    return { _tag: "Entrypoint", argv: JSON.parse(line.slice("ENTRYPOINT ".length)) }
  }
  if (line.startsWith("HEALTHCHECK ")) return parseHealthcheck(line)
  throw new Error(`unknown instruction: ${line}`)
}

const parseDockerfile = (text: string): Dockerfile => {
  const lines = text.split("\n").filter((l) => l.length > 0 && !l.startsWith("#"))
  const args: Dockerfile["args"] = []
  const stages: Stage[] = []
  let current: Stage | undefined
  let stageWorkdirSet = false
  for (const line of lines) {
    if (line.startsWith("ARG ")) {
      const body = line.slice("ARG ".length)
      const eq = body.indexOf("=")
      args.push(
        eq < 0 ? { name: body } : { name: body.slice(0, eq), default: body.slice(eq + 1) }
      )
      continue
    }
    if (line.startsWith("FROM ")) {
      const parsed = parseFrom(line)
      current = {
        name: parsed.name,
        from: parsed.from,
        ...(parsed.platform ? { platform: parsed.platform } : {}),
        instructions: []
      }
      stages.push(current)
      stageWorkdirSet = false
      continue
    }
    if (!current) throw new Error("instruction before any FROM")
    if (line.startsWith("WORKDIR ") && !stageWorkdirSet && current.instructions.length === 0) {
      current = { ...current, workdir: line.slice("WORKDIR ".length) }
      stages[stages.length - 1] = current
      stageWorkdirSet = true
      continue
    }
    current = { ...current, instructions: [...current.instructions, parseInstruction(line)] }
    stages[stages.length - 1] = current
  }
  return { args, stages }
}

// ────────────────────────── fast-check arbitraries ────────────────────────

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

const fromImage = fc
  .record({ image: safeStr, tag: safeStr })
  .map((r) => ({ _tag: "FromImage" as const, image: r.image, tag: r.tag }))

const copyArb: fc.Arbitrary<Instruction> = fc
  .tuple(
    fc.option(safeStr, { nil: undefined }),
    fc.array(safeStr, { minLength: 1, maxLength: 3 }),
    safeStr
  )
  .map(([from, src, dst]) => ({
    _tag: "Copy",
    src,
    dst,
    ...(from ? { from } : {})
  }))

const envArb: fc.Arbitrary<Instruction> = fc
  .array(fc.tuple(safeEnvKey, safeEnvVal), { minLength: 1, maxLength: 3 })
  .map((entries) => ({ _tag: "Env", entries }))

const exposeArb: fc.Arbitrary<Instruction> = fc
  .tuple(port, fc.option(fc.constantFrom<"tcp" | "udp">("tcp", "udp"), { nil: undefined }))
  .map(([p, proto]) => ({ _tag: "Expose", port: p, ...(proto ? { protocol: proto } : {}) }))

const argvArb = fc.array(safeStr, { minLength: 1, maxLength: 3 })

const healthArb: fc.Arbitrary<Instruction> = fc
  .tuple(
    argvArb,
    fc.option(duration, { nil: undefined }),
    fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined })
  )
  .map(([argv, interval, retries]) => ({
    _tag: "Healthcheck",
    check: {
      _tag: "Cmd",
      argv,
      ...(interval ? { interval } : {}),
      ...(retries !== undefined ? { retries } : {})
    }
  }))

const instructionArb: fc.Arbitrary<Instruction> = fc.oneof(
  copyArb,
  safeStr.map((s) => ({ _tag: "Run", cmd: `cmd-${s}` }) satisfies Instruction),
  envArb,
  exposeArb,
  safeStr.map((u) => ({ _tag: "User", user: u }) satisfies Instruction),
  safeStr.map((p) => ({ _tag: "Workdir", path: `/${p}` }) satisfies Instruction),
  argvArb.map((argv) => ({ _tag: "Cmd", argv }) satisfies Instruction),
  argvArb.map((argv) => ({ _tag: "Entrypoint", argv }) satisfies Instruction),
  healthArb
)

const stageArb: fc.Arbitrary<Stage> = fc
  .record({
    name: safeStr,
    from: fromImage,
    workdir: fc.option(safeStr.map((p) => `/${p}`), { nil: undefined }),
    instructions: fc.array(instructionArb, { minLength: 0, maxLength: 4 })
  })
  .map((s) => ({
    name: s.name,
    from: s.from,
    ...(s.workdir ? { workdir: s.workdir } : {}),
    instructions: s.instructions
  }))

const dockerfileArb: fc.Arbitrary<Dockerfile> = fc
  .array(stageArb, { minLength: 1, maxLength: 3 })
  .map((stages): Dockerfile => {
    const unique: Stage[] = []
    const seen = new Set<string>()
    for (const s of stages) {
      let name = s.name
      let i = 0
      while (seen.has(name)) {
        i++
        name = `${s.name}${i}`
      }
      seen.add(name)
      unique.push({ ...s, name })
    }
    return { args: [], stages: unique }
  })

// ─────────────────────────────── tests ────────────────────────────────────

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
