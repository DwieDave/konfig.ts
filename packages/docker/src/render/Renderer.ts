import { Match } from "effect"
import type { Dockerfile, From, HealthcheckIR, Instruction, PlatformIR, Stage } from "../ir/DockerfileIR"

const _json = (argv: ReadonlyArray<string>): string => JSON.stringify(argv)

const _renderPlatformFlag = (p: PlatformIR | undefined): string => {
  if (!p) return ""
  if (p._tag === "Single") return `--platform=${p.value} `
  return ""
}

const _renderFrom = (f: From, platform: PlatformIR | undefined, name: string): string => {
  const platformFlag = _renderPlatformFlag(platform)
  if (f._tag === "FromImage") return `FROM ${platformFlag}${f.image}:${f.tag} AS ${name}`
  return `FROM ${platformFlag}${f.stage} AS ${name}`
}

const _renderCopy = (i: Extract<Instruction, { _tag: "Copy" }>): string => {
  const flags: string[] = []
  if (i.from) flags.push(`--from=${i.from}`)
  if (i.chown) flags.push(`--chown=${i.chown}`)
  const flagStr = flags.length === 0 ? "" : `${flags.join(" ")} `
  return `COPY ${flagStr}${i.src.join(" ")} ${i.dst}`
}

const _renderEnv = (i: Extract<Instruction, { _tag: "Env" }>): string => {
  const pairs = i.entries.map(([k, v]) => `${k}=${_quoteIfNeeded(v)}`).join(" ")
  return `ENV ${pairs}`
}

const _quoteIfNeeded = (v: string): string => {
  if (/[\s"'\\]/.test(v)) return JSON.stringify(v)
  return v
}

const _renderHealthcheck = (h: HealthcheckIR): string => {
  if (h._tag === "None") return "HEALTHCHECK NONE"
  const flags: string[] = []
  if (h.interval) flags.push(`--interval=${h.interval}`)
  if (h.timeout) flags.push(`--timeout=${h.timeout}`)
  if (h.retries !== undefined) flags.push(`--retries=${h.retries}`)
  if (h.startPeriod) flags.push(`--start-period=${h.startPeriod}`)
  const flagStr = flags.length === 0 ? "" : `${flags.join(" ")} `
  return `HEALTHCHECK ${flagStr}CMD ${_json(h.argv)}`
}

const _renderInstruction = (i: Instruction): string =>
  Match.value(i).pipe(
    Match.tag("Copy", (c) => _renderCopy(c)),
    Match.tag("Run", (r) => `RUN ${r.cmd}`),
    Match.tag("Env", (e) => _renderEnv(e)),
    Match.tag("Expose", (e) => `EXPOSE ${e.port}${e.protocol ? `/${e.protocol}` : ""}`),
    Match.tag("User", (u) => `USER ${u.user}`),
    Match.tag("Workdir", (w) => `WORKDIR ${w.path}`),
    Match.tag("Cmd", (c) => `CMD ${_json(c.argv)}`),
    Match.tag("Entrypoint", (e) => `ENTRYPOINT ${_json(e.argv)}`),
    Match.tag("Healthcheck", (h) => _renderHealthcheck(h.check)),
    Match.exhaustive
  )

const _renderStage = (s: Stage): string => {
  const lines: string[] = [_renderFrom(s.from, s.platform, s.name)]
  if (s.workdir) lines.push(`WORKDIR ${s.workdir}`)
  for (const i of s.instructions) lines.push(_renderInstruction(i))
  return lines.join("\n")
}

const _renderArg = (a: { name: string; default?: string }): string =>
  a.default === undefined ? `ARG ${a.name}` : `ARG ${a.name}=${a.default}`

export const render = (df: Dockerfile): string => {
  const sections: string[] = []
  if (df.args.length > 0) sections.push(df.args.map(_renderArg).join("\n"))
  for (const s of df.stages) sections.push(_renderStage(s))
  return `${sections.join("\n\n")}\n`
}
