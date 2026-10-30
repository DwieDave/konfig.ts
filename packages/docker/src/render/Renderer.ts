import { Match } from "effect"
import type { Dockerfile, From, HealthcheckIR, Instruction, PlatformIR, Stage } from "../ir/DockerfileIR"

const _json = (argv: ReadonlyArray<string>): string => JSON.stringify(argv)

const _renderPlatformFlag = (p: PlatformIR | undefined): string => (p ? `--platform=${p.value} ` : "")

const _renderFrom = (
  input: { readonly from: From; readonly platform: PlatformIR | undefined; readonly name: string }
): string =>
  Match.value(input.from).pipe(
    Match.tag("FromImage", (i) => `FROM ${_renderPlatformFlag(input.platform)}${i.image}:${i.tag} AS ${input.name}`),
    Match.tag("FromStage", (s) => `FROM ${_renderPlatformFlag(input.platform)}${s.stage} AS ${input.name}`),
    Match.exhaustive
  )

const _needsExecForm = (path: string): boolean => /[\s"\\]/.test(path) || path.startsWith("[")

const _copyPaths = (i: Extract<Instruction, { _tag: "Copy" }>): string =>
  [...i.src, i.dst].some(_needsExecForm) ? _json([...i.src, i.dst]) : `${i.src.join(" ")} ${i.dst}`

const _renderCopy = (i: Extract<Instruction, { _tag: "Copy" }>): string => {
  const flags: string[] = []

  if (i.from) flags.push(`--from=${i.from}`)

  if (i.chown) flags.push(`--chown=${i.chown}`)
  const flagStr = flags.length === 0 ? "" : `${flags.join(" ")} `

  return `COPY ${flagStr}${_copyPaths(i)}`
}

const _renderEnv = (i: Extract<Instruction, { _tag: "Env" }>): string => {
  const pairs = i.entries.map(([k, v]) => `${k}=${_quoteIfNeeded(v)}`).join(" ")

  return `ENV ${pairs}`
}

const _quoteIfNeeded = (v: string): string => /[\s"'\\$]/.test(v) ? JSON.stringify(v).replaceAll("$", "\\$") : v

const _renderHealthcheck = (h: HealthcheckIR): string => {
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
    Match.tag("Expose", (e) => `EXPOSE ${e.port}`),
    Match.tag("User", (u) => `USER ${u.user}`),
    Match.tag("Workdir", (w) => `WORKDIR ${w.path}`),
    Match.tag("Cmd", (c) => `CMD ${_json(c.argv)}`),
    Match.tag("Entrypoint", (e) => `ENTRYPOINT ${_json(e.argv)}`),
    Match.tag("Healthcheck", (h) => _renderHealthcheck(h.check)),
    Match.exhaustive
  )

const _renderStage = (s: Stage): string =>
  [
    _renderFrom({ from: s.from, platform: s.platform, name: s.name }),
    ...(s.workdir ? [`WORKDIR ${s.workdir}`] : []),
    ...s.instructions.map(_renderInstruction)
  ].join("\n")

export const render = (df: Dockerfile): string => `${df.stages.map(_renderStage).join("\n\n")}\n`
