import { Effect, Match } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import {
  type AnyDockerError,
  BuildScriptMissing,
  BunVersionUnsupported,
  EngineVersionMissing,
  PlatformMultiUnsupported,
  SharedRootFileMissing,
  WorkspaceNotFound,
  WorkspaceSourceUnknown
} from "../DockerError"
import type { ImageRef, NodeModulesLayout, PackageManager, PmKind, YarnVariant } from "../services/PackageManager"
import { bun as bunPm } from "../services/pm/bun"
import { npm as npmPm } from "../services/pm/npm"
import { pnpm as pnpmPm } from "../services/pm/pnpm"
import { yarn as yarnPm } from "../services/pm/yarn"
import type { Runtime } from "../services/Runtime"
import { bun as bunRuntime } from "../services/runtime/bun"
import { node as nodeRuntime } from "../services/runtime/node"
import {
  allWorkspaces,
  closureOf,
  type DetectedPm,
  detectPm,
  existsOrFalse,
  findRoot,
  type RootDir,
  type Workspace
} from "../services/WorkspaceGraph"
import type { CopyAtom, DevSpec, DockerSpec, HealthcheckAtom, RunnerSpec, UserAtom } from "../spec"
import { MIN_FILTERED_INSTALL, supportsFilteredInstall } from "./bunVersion"
import type { Dockerfile, DockerfileBundle, Instruction, Stage } from "./DockerfileIR"
import { shGlobQuote, shJoin } from "./shell"

export interface LowerContext {
  readonly root: RootDir
  readonly allWorkspaces: ReadonlyArray<Workspace>
  readonly closure: ReadonlyArray<Workspace>
  readonly buildClosure: ReadonlyArray<Workspace>
  readonly target: Workspace
  readonly detectedPm: DetectedPm
  readonly hasPatchesDir: boolean
}

const _lookupTarget = (
  all: ReadonlyArray<Workspace>,
  ref: string,
  root: string
): Workspace | undefined => {
  const byNameOrRel = all.find((w) => w.name === ref || w.relDir === ref)
  if (byNameOrRel) return byNameOrRel
  if (ref.startsWith(root)) {
    const rel = ref.slice(root.length).replace(/^[/\\]+/, "")
    return all.find((w) => w.relDir === rel)
  }
  return undefined
}

export const prepareContext = (
  spec: DockerSpec
): Effect.Effect<LowerContext, AnyDockerError, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const p = yield* Path
    const root = yield* findRoot(spec.target)
    const all = yield* allWorkspaces(root)
    const target = _lookupTarget(all, spec.target, root)
    if (!target) return yield* new WorkspaceNotFound({ target: spec.target })
    const detectedPm = yield* detectPm(root)
    const closure = yield* closureOf({ all, target: target.name })
    const buildClosure = yield* closureOf({ all, target: target.name, includeDev: true })
    const hasPatchesDir = yield* existsOrFalse({ fs, path: p.join(root, "patches") })
    return { root, allWorkspaces: all, closure, buildClosure, target, detectedPm, hasPatchesDir }
  })

type RuntimeKind = "Bun" | "Node"

const _specPmKind = (s: DockerSpec): PmKind | undefined =>
  Match.value(s.packageManager?._tag).pipe(
    Match.when("BunPm", (): PmKind => "Bun"),
    Match.when("NpmPm", (): PmKind => "Npm"),
    Match.when("PnpmPm", (): PmKind => "Pnpm"),
    Match.when("YarnPm", (): PmKind => "Yarn"),
    Match.orElse((): PmKind | undefined => undefined)
  )

const _specRuntimeKind = (s: DockerSpec): RuntimeKind | undefined =>
  Match.value(s.runtime?._tag).pipe(
    Match.when("BunRuntime", (): RuntimeKind => "Bun"),
    Match.when("NodeRuntime", (): RuntimeKind => "Node"),
    Match.orElse((): RuntimeKind | undefined => undefined)
  )

const _defaultRuntimeFor = (pm: PmKind): RuntimeKind => (pm === "Bun" ? "Bun" : "Node")

interface PmImplOpts {
  readonly layout: NodeModulesLayout
  readonly yarnVariant: YarnVariant
}

const _pmImpl = (kind: PmKind, opts: PmImplOpts): PackageManager => {
  if (kind === "Bun") return bunPm
  if (kind === "Npm") return npmPm
  if (kind === "Yarn") return yarnPm({ variant: opts.yarnVariant })
  return pnpmPm({ layout: opts.layout })
}

const _runtimeImpl = (kind: RuntimeKind): Runtime => (kind === "Bun" ? bunRuntime : nodeRuntime)

const _engineKey = (kind: PmKind | RuntimeKind): string => kind.toLowerCase()

interface EngineInput {
  readonly ws: Workspace
  readonly kind: PmKind | RuntimeKind
}

const _requireEngineVersion = (input: EngineInput): Effect.Effect<string, EngineVersionMissing> => {
  const key = _engineKey(input.kind)
  const version = input.ws.pkg.engines?.[key]
  return version
    ? Effect.succeed(version)
    : Effect.fail(new EngineVersionMissing({ target: input.ws.name, engineField: `engines.${key}` }))
}

interface ValidateSpecInput {
  readonly spec: DockerSpec
  readonly ctx: LowerContext
}

export const validateSpec = (
  input: ValidateSpecInput
): Effect.Effect<void, AnyDockerError, FileSystem | Path> =>
  Effect.gen(function*() {
    const { spec, ctx } = input
    const fs = yield* FileSystem
    const p = yield* Path

    const closureNames = new Set<string>(ctx.closure.map((w) => w.name))
    for (const c of spec.runner.copy) {
      if (c._tag === "WorkspaceSource" && !closureNames.has(c.name)) {
        return yield* new WorkspaceSourceUnknown({ target: ctx.target.name, missingWorkspace: c.name })
      }
    }

    // FROM --platform takes exactly one value; multi-arch is a buildx/manifest
    // concern (`docker buildx build --platform`), not something a single FROM
    // line can express. Reject Multi here rather than silently dropping it.
    if (spec.runner.platform?._tag === "PlatformMulti") {
      return yield* new PlatformMultiUnsupported({
        target: ctx.target.name,
        values: spec.runner.platform.values
      })
    }

    if (spec.build?._tag === "BuildScript") {
      const script = spec.build.script
      if (!ctx.target.pkg.scripts?.[script]) {
        return yield* new BuildScriptMissing({ target: ctx.target.name, script })
      }
    }

    for (const path of spec.sharedRootFiles ?? []) {
      const ok = yield* existsOrFalse({ fs, path: p.join(ctx.root, path) })
      if (!ok) {
        return yield* new SharedRootFileMissing({ target: ctx.target.name, path })
      }
    }
  })

const HARDENED_DEFAULT_USER = { uid: 1001, gid: 1001, name: "app" } as const

const _envToInstruction = (env: Record<string, string> | undefined): Instruction | undefined => {
  if (!env) return undefined
  const entries = Object.entries(env).sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) return undefined
  return { _tag: "Env", entries }
}

const _exposeToInstructions = (
  expose: number | ReadonlyArray<number> | undefined
): ReadonlyArray<Instruction> => {
  if (expose === undefined) return []
  const ports = typeof expose === "number" ? [expose] : expose
  return ports.map((port): Instruction => ({ _tag: "Expose", port }))
}

// `WorkspaceSourceAll` expands to one `WorkspaceSource` per closure
// workspace, including the target itself: the target's own source is what
// makes `cmd`/`entrypoint` runnable in the runner stage (e.g. `bun run
// src/main.ts`), so a spec relying on this atom must not have to also spell
// out `Docker.copy.targetSource()`. Specs that build to a bundled artifact
// instead should skip this atom and copy that artifact explicitly via
// `Docker.copy.builderArtifact()`.
const _expandWorkspaceSourceAll = (
  copy: ReadonlyArray<CopyAtom>,
  closure: ReadonlyArray<Workspace>
): ReadonlyArray<CopyAtom> => {
  const out: CopyAtom[] = []
  for (const c of copy) {
    if (c._tag === "WorkspaceSourceAll") {
      for (const w of closure) {
        out.push({ _tag: "WorkspaceSource", name: w.name })
      }
    } else {
      out.push(c)
    }
  }
  return out
}

const _copyAtomToInstruction = (
  c: CopyAtom,
  ctx: LowerContext
): Instruction | undefined => {
  const tgt = ctx.target
  if (c._tag === "WorkspaceSourceAll") return undefined
  if (c._tag === "BuilderArtifact") {
    return {
      _tag: "Copy",
      from: "builder",
      src: [`/app/${tgt.relDir}/${c.src}`],
      dst: `/app/${tgt.relDir}/${c.dst}`,
      ...(c.chown ? { chown: c.chown } : {})
    }
  }
  if (c._tag === "WorkspaceSource") {
    const ws = ctx.closure.find((w) => w.name === c.name)
    if (!ws) return undefined
    return {
      _tag: "Copy",
      from: "builder",
      src: [`/app/${ws.relDir}`],
      dst: `/app/${ws.relDir}`
    }
  }
  if (c._tag === "CopyPath") {
    return {
      _tag: "Copy",
      ...(c.from ? { from: c.from } : {}),
      src: [c.src],
      dst: c.dst,
      ...(c.chown ? { chown: c.chown } : {})
    }
  }
  return undefined
}

interface UserInput {
  readonly user: UserAtom | undefined
  readonly alpine: boolean
}

interface AccountIds {
  readonly uid: number
  readonly gid: number
  readonly name: string
}

const _alpineAccountCmd = (a: AccountIds): string =>
  `addgroup -S -g ${a.gid} ${a.name} && adduser -S -u ${a.uid} -G ${a.name} ${a.name}`

const _debianAccountCmd = (a: AccountIds): string =>
  `groupadd --system --gid ${a.gid} ${a.name} && useradd --system --uid ${a.uid} --gid ${a.name} --no-create-home --shell /usr/sbin/nologin ${a.name}`

const _userInstructions = (input: UserInput): {
  readonly setupRun: Instruction | undefined
  readonly user: Instruction | undefined
  readonly chown: string | undefined
} => {
  const effective: UserAtom = input.user ?? { _tag: "UserNonRoot" }
  if (effective._tag === "UserRoot") return { setupRun: undefined, user: undefined, chown: undefined }
  const ids: AccountIds = {
    uid: effective.uid ?? HARDENED_DEFAULT_USER.uid,
    gid: effective.gid ?? HARDENED_DEFAULT_USER.gid,
    name: effective.name ?? HARDENED_DEFAULT_USER.name
  }
  const cmd = input.alpine ? _alpineAccountCmd(ids) : _debianAccountCmd(ids)
  return {
    setupRun: { _tag: "Run", cmd },
    user: { _tag: "User", user: ids.name },
    chown: `${ids.name}:${ids.name}`
  }
}

const _runnerIsAlpine = (runner: RunnerSpec, pm: PmContext): boolean =>
  runner.baseImage ? /alpine/i.test(`${runner.baseImage.image}:${runner.baseImage.tag}`) : pm.alpine

interface PmContext {
  readonly pmKind: PmKind
  readonly runtimeKind: RuntimeKind
  readonly pmVersion: string
  readonly runtimeVersion: string
  readonly pmImpl: PackageManager
  readonly runtimeImpl: Runtime
  readonly runtimeImage: ImageRef
  readonly depsImage: ImageRef
  readonly alpine: boolean
  readonly rootFiles: ReadonlyArray<string>
}

const _presentRootFiles = (
  root: string,
  pm: PackageManager
): Effect.Effect<ReadonlyArray<string>, never, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const p = yield* Path
    return yield* Effect.filter(
      [...pm.lockfileNames, ...pm.auxFiles],
      (f) => existsOrFalse({ fs, path: p.join(root, f) })
    )
  })

const _resolveDefaults = (
  spec: DockerSpec,
  ctx: LowerContext
): Effect.Effect<PmContext, AnyDockerError, FileSystem | Path> =>
  Effect.gen(function*() {
    const pmKind: PmKind = _specPmKind(spec) ?? ctx.detectedPm.kind
    const runtimeKind: RuntimeKind = _specRuntimeKind(spec) ?? _defaultRuntimeFor(pmKind)
    const alpine = spec.runtime?._tag === "BunRuntime" || spec.runtime?._tag === "NodeRuntime"
      ? spec.runtime.alpine ?? true
      : true
    const pmVersion = yield* _requireEngineVersion({ ws: ctx.target, kind: pmKind })
    const runtimeVersion = yield* _requireEngineVersion({ ws: ctx.target, kind: runtimeKind })
    const pm = _pmImpl(pmKind, {
      layout: ctx.detectedPm.pnpmLayout ?? "isolated",
      yarnVariant: ctx.detectedPm.yarnVariant ?? "classic"
    })
    const runtime = _runtimeImpl(runtimeKind)
    const runtimeImage = runtime.imageRef({ version: runtimeVersion, alpine })
    const depsImage = pm.depsImage({ runtimeImage, pmVersion })
    const rootFiles = yield* _presentRootFiles(ctx.root, pm)
    return {
      pmKind,
      runtimeKind,
      pmVersion,
      runtimeVersion,
      pmImpl: pm,
      runtimeImpl: runtime,
      runtimeImage,
      depsImage,
      alpine,
      rootFiles
    }
  })

// The bun prod-deps stage relies on `bun install --filter`.
const _checkBunFilterSupport = (
  spec: DockerSpec,
  ctx: LowerContext,
  pm: PmContext
): Effect.Effect<void, BunVersionUnsupported> =>
  pm.pmKind === "Bun" && spec.runner.production && !supportsFilteredInstall(pm.pmVersion)
    ? Effect.fail(
      new BunVersionUnsupported({
        target: ctx.target.name,
        version: pm.pmVersion,
        minimum: `${MIN_FILTERED_INSTALL.major}.${MIN_FILTERED_INSTALL.minor}`
      })
    )
    : Effect.void

const _baseStage = (img: ImageRef): Stage => ({
  name: "base",
  from: { _tag: "FromImage", image: img.image, tag: img.tag },
  instructions: []
})

const _rootCopyInstructions = (ctx: LowerContext, pm: PmContext): Instruction[] => {
  const instructions: Instruction[] = [{ _tag: "Copy", src: ["package.json", ...pm.rootFiles], dst: "./" }]
  if (ctx.hasPatchesDir) {
    instructions.push({ _tag: "Copy", src: ["patches"], dst: "./patches" })
  }
  return instructions
}

const _packageJsonCopyInstructions = (workspaces: ReadonlyArray<Workspace>): Instruction[] =>
  workspaces.map((ws): Instruction => ({
    _tag: "Copy",
    src: [`${ws.relDir}/package.json`],
    dst: `./${ws.relDir}/`
  }))

// Restricts root package.json's `workspaces` array to the closure so
// install doesn't pull in unrelated workspaces' deps; also wipes
// devDependencies since --production still needs to RESOLVE them, and
// non-closure workspace:* deps would otherwise fail resolution. Script
// uses double quotes so it can be wrapped in a single-quoted shell string.
const _prodDepsWorkspaceRewriteInstruction = (ctx: LowerContext): Instruction => {
  const closureRelDirs = ctx.closure.map((ws) => ws.relDir).sort()
  const rewriteScript = `const fs=require("fs"); const p=JSON.parse(fs.readFileSync("package.json","utf-8"));` +
    ` p.workspaces=${JSON.stringify(closureRelDirs)};` +
    ` delete p.devDependencies;` +
    ` fs.writeFileSync("package.json", JSON.stringify(p,null,2));`
  return { _tag: "Run", cmd: `node -e '${rewriteScript}'` }
}

// Bun installs straight from the untouched lockfile: --frozen-lockfile pins
// versions and --filter narrows to the target's closure. bun refuses a
// lockfile whose workspaces aren't all on disk, so every package.json is copied.
const _bunProdDepsInstructions = (ctx: LowerContext, pm: PmContext): Instruction[] => [
  ..._packageJsonCopyInstructions(ctx.allWorkspaces),
  ..._runs(pm.pmImpl.prependDepsRuns(pm.pmVersion)),
  { _tag: "Run", cmd: [..._prodInstallCmd(pm), "--filter", ctx.target.name].join(" ") }
]

// Other managers keep the lockfile only as a hint and run a non-frozen
// install (no --frozen-lockfile/--immutable/ci) against a root package.json
// trimmed to the closure.
const _rewriteProdDepsInstructions = (ctx: LowerContext, pm: PmContext): Instruction[] => [
  _prodDepsWorkspaceRewriteInstruction(ctx),
  ..._packageJsonCopyInstructions(ctx.closure),
  ..._runs(pm.pmImpl.prependDepsRuns(pm.pmVersion)),
  { _tag: "Run", cmd: _prodInstallCmd(pm).join(" ") }
]

const _runs = (cmds: ReadonlyArray<string>): Instruction[] => cmds.map((cmd): Instruction => ({ _tag: "Run", cmd }))

const _prodInstallCmd = (pm: PmContext): ReadonlyArray<string> => [
  ...pm.pmImpl.prodInstallCommand,
  ...pm.pmImpl.productionFlag
]

const _prodDepsInstallInstructions = (ctx: LowerContext, pm: PmContext): Instruction[] =>
  pm.pmKind === "Bun" ? _bunProdDepsInstructions(ctx, pm) : _rewriteProdDepsInstructions(ctx, pm)

// Glob metacharacters stay bare so versioned store dirs such as
// node_modules/.bun/<name>@<ver> expand in the shell.
// Applied after install (not in the runner) so the deletion actually
// shrinks the layer rather than just adding a deletion marker.
const _removePathInstructions = (paths: ReadonlyArray<string> | undefined): Instruction[] =>
  (paths ?? []).map((path): Instruction => ({ _tag: "Run", cmd: `rm -rf ${shGlobQuote(path)}` }))

const _prodDepsStage = (spec: DockerSpec, ctx: LowerContext, pm: PmContext): Stage => {
  return _stage({
    name: "prod-deps",
    instructions: [
      ..._rootCopyInstructions(ctx, pm),
      ..._prodDepsInstallInstructions(ctx, pm),
      ..._removePathInstructions(spec.runner.removePaths)
    ]
  })
}

interface StageInput {
  readonly name: string
  readonly instructions: ReadonlyArray<Instruction>
}

const _stage = (input: StageInput): Stage => ({
  name: input.name,
  from: { _tag: "FromStage", stage: "base" },
  workdir: "/app",
  instructions: input.instructions
})

const _depsStage = (ctx: LowerContext, pm: PmContext): Stage =>
  _stage({
    name: "deps",
    instructions: [
      ..._rootCopyInstructions(ctx, pm),
      ..._packageJsonCopyInstructions(ctx.allWorkspaces),
      ..._runs(pm.pmImpl.prependDepsRuns(pm.pmVersion)),
      { _tag: "Run", cmd: pm.pmImpl.installCommand.join(" ") }
    ]
  })

const _sharedRootCopies = (spec: DockerSpec): Instruction[] =>
  (spec.sharedRootFiles ?? []).map((path): Instruction => ({ _tag: "Copy", src: [path], dst: `./${path}` }))

const _closureSourceCopies = (ctx: LowerContext): Instruction[] =>
  ctx.buildClosure.map((ws): Instruction => ({ _tag: "Copy", src: [ws.relDir], dst: `./${ws.relDir}` }))

const _envWithDefault = (input: {
  readonly env: Record<string, string> | undefined
  readonly nodeEnv: string
}): Instruction | undefined => _envToInstruction({ NODE_ENV: input.nodeEnv, ...input.env })

const _builderStage = (
  spec: DockerSpec,
  ctx: LowerContext,
  pm: PmContext
): Stage => {
  const instructions: Instruction[] = [
    ..._sharedRootCopies(spec),
    { _tag: "Copy", from: "deps", src: ["/app/node_modules"], dst: "/app/node_modules" }
  ]
  if (pm.pmImpl.nodeModulesLayout !== "hoisted") {
    for (const ws of ctx.closure) {
      instructions.push({
        _tag: "Copy",
        from: "deps",
        src: [`/app/${ws.relDir}/node_modules`],
        dst: `/app/${ws.relDir}/node_modules`
      })
    }
  }
  instructions.push(..._closureSourceCopies(ctx))
  instructions.push({ _tag: "Workdir", path: `/app/${ctx.target.relDir}` })
  const build = spec.build ?? (ctx.target.hasBuildScript
    ? ({ _tag: "BuildScript", script: "build" } as const)
    : ({ _tag: "BuildNone" } as const))
  if (build._tag === "BuildScript") {
    instructions.push({ _tag: "Run", cmd: `${pm.pmKind.toLowerCase()} run ${build.script}` })
  } else if (build._tag === "BuildCommand") {
    instructions.push({ _tag: "Run", cmd: shJoin(build.argv) })
  }
  return _stage({ name: "builder", instructions })
}

const _platformAtomToIR = (
  p: DockerSpec["runner"]["platform"]
): Stage["platform"] => {
  if (!p) return undefined
  return Match.value(p).pipe(
    Match.tag("PlatformLinuxAmd64", (): Stage["platform"] => ({ _tag: "Single", value: "linux/amd64" })),
    Match.tag("PlatformLinuxArm64", (): Stage["platform"] => ({ _tag: "Single", value: "linux/arm64" })),
    Match.tag("PlatformMulti", (m): Stage["platform"] => ({ _tag: "Multi", values: m.values })),
    Match.exhaustive
  )
}

const _runnerEnvAndExposeInstructions = (runner: RunnerSpec): ReadonlyArray<Instruction> => {
  const envInstr = _envWithDefault({ env: runner.env, nodeEnv: "production" })
  return [...(envInstr ? [envInstr] : []), ..._exposeToInstructions(runner.expose)]
}

const _usesCustomBase = (runner: RunnerSpec): boolean => runner.baseImage !== undefined

const _nodeModulesFrom = (runner: RunnerSpec): "prod-deps" | "builder" => runner.production ? "prod-deps" : "builder"

// Workspace source needs the root node_modules too, so workspace:*
// symlinks resolve at runtime.
const _runnerRootNodeModulesInstructions = (
  runner: RunnerSpec,
  usesWorkspaceSource: boolean,
  chown: { readonly chown?: string }
): ReadonlyArray<Instruction> => {
  if (!usesWorkspaceSource || _usesCustomBase(runner)) return []
  return [{
    _tag: "Copy",
    from: _nodeModulesFrom(runner),
    src: ["/app/node_modules"],
    dst: "/app/node_modules",
    ...chown
  }]
}

// Under an isolated linker (e.g. bun), each workspace keeps its own
// node_modules of symlinks into the shared store; these must come from
// the same source stage as the root copy to stay consistent with it.
const _runnerWorkspaceNodeModulesInstructions = (
  runner: RunnerSpec,
  ctx: LowerContext,
  pm: PmContext,
  usesWorkspaceSource: boolean,
  chown: { readonly chown?: string }
): ReadonlyArray<Instruction> => {
  if (!usesWorkspaceSource || _usesCustomBase(runner) || pm.pmImpl.nodeModulesLayout === "hoisted") return []
  return ctx.closure.map((ws): Instruction => ({
    _tag: "Copy",
    from: _nodeModulesFrom(runner),
    src: [`/app/${ws.relDir}/node_modules`],
    dst: `/app/${ws.relDir}/node_modules`,
    ...chown
  }))
}

const _runnerCopyInstructions = (
  expandedCopy: ReadonlyArray<CopyAtom>,
  ctx: LowerContext,
  chown: string | undefined
): Instruction[] => {
  const out: Instruction[] = []
  for (const c of expandedCopy) {
    let instr = _copyAtomToInstruction(c, ctx)
    if (!instr) continue
    if (instr._tag === "Copy" && !instr.chown && chown) instr = { ...instr, chown }
    out.push(instr)
  }
  return out
}

const _healthcheckArgv = (hc: HealthcheckAtom): ReadonlyArray<string> =>
  hc._tag === "HealthcheckHttpGet" ? ["wget", "--spider", "-q", `http://localhost:${hc.port}${hc.path}`] : hc.argv

const _runnerHealthcheckInstruction = (hc: HealthcheckAtom | undefined): Instruction | undefined => {
  if (!hc) return undefined
  return {
    _tag: "Healthcheck",
    check: {
      _tag: "Cmd",
      argv: _healthcheckArgv(hc),
      ...(hc.interval ? { interval: hc.interval } : {}),
      ...(hc.timeout ? { timeout: hc.timeout } : {}),
      ...(hc.retries !== undefined ? { retries: hc.retries } : {}),
      ...(hc.startPeriod ? { startPeriod: hc.startPeriod } : {})
    }
  }
}

const _runnerFromIR = (runner: RunnerSpec): Stage["from"] =>
  runner.baseImage
    ? { _tag: "FromImage", image: runner.baseImage.image, tag: runner.baseImage.tag }
    : { _tag: "FromStage", stage: "base" }

const _runnerStage = (
  spec: DockerSpec,
  ctx: LowerContext,
  pm: PmContext
): Stage => {
  const runner: RunnerSpec = spec.runner
  const user = _userInstructions({ user: runner.user, alpine: _runnerIsAlpine(runner, pm) })
  const expandedCopy = _expandWorkspaceSourceAll(runner.copy, ctx.closure)
  const usesWorkspaceSource = expandedCopy.some((c) => c._tag === "WorkspaceSource")
  const chown = user.chown ? { chown: user.chown } : {}
  const healthcheck = _runnerHealthcheckInstruction(runner.healthcheck)
  const instructions: Instruction[] = [
    ...(user.setupRun ? [user.setupRun] : []),
    ..._runnerEnvAndExposeInstructions(runner),
    ..._runnerRootNodeModulesInstructions(runner, usesWorkspaceSource, chown),
    ..._runnerCopyInstructions(expandedCopy, ctx, user.chown),
    ..._runnerWorkspaceNodeModulesInstructions(runner, ctx, pm, usesWorkspaceSource, chown),
    ...(healthcheck ? [healthcheck] : []),
    ...(runner.entrypoint ? [{ _tag: "Entrypoint" as const, argv: runner.entrypoint }] : []),
    ...(user.user ? [user.user] : []),
    { _tag: "Cmd" as const, argv: runner.cmd }
  ]
  const platform = _platformAtomToIR(runner.platform)
  return {
    name: "runner",
    from: _runnerFromIR(runner),
    ...(platform ? { platform } : {}),
    workdir: runner.workdir,
    instructions
  }
}

const _devStage = (spec: DockerSpec, ctx: LowerContext, pm: PmContext, dev: DevSpec): Stage => {
  // dev installs scripts (no --ignore-scripts) so binaries are usable
  const devInstall = pm.pmImpl.installCommand.filter((s) => s !== "--ignore-scripts")
  const envInstr = _envWithDefault({ env: dev.env, nodeEnv: "development" })
  return _stage({
    name: "dev",
    instructions: [
      ..._rootCopyInstructions(ctx, pm),
      ..._packageJsonCopyInstructions(ctx.allWorkspaces),
      ..._runs(pm.pmImpl.prependDepsRuns(pm.pmVersion)),
      { _tag: "Run", cmd: devInstall.join(" ") },
      ..._sharedRootCopies(spec),
      ..._closureSourceCopies(ctx),
      { _tag: "Workdir", path: dev.workdir ?? `/app/${ctx.target.relDir}` },
      ...(envInstr ? [envInstr] : []),
      ..._exposeToInstructions(dev.expose),
      { _tag: "Cmd", argv: dev.cmd }
    ]
  })
}

export interface BuildIRInput {
  readonly spec: DockerSpec
  readonly ctx: LowerContext
  readonly pm: PmContext
}

export const buildIR = (input: BuildIRInput): DockerfileBundle => {
  const { spec, ctx, pm } = input
  const base = _baseStage(pm.runtimeImage)
  const prodStages: Stage[] = [
    base,
    _depsStage(ctx, pm),
    _builderStage(spec, ctx, pm)
  ]
  if (spec.runner.production) {
    prodStages.push(_prodDepsStage(spec, ctx, pm))
  }
  prodStages.push(_runnerStage(spec, ctx, pm))
  const prod: Dockerfile = { args: [], stages: prodStages }
  if (!spec.dev) return { prod }
  const dev: Dockerfile = { args: [], stages: [base, _devStage(spec, ctx, pm, spec.dev)] }
  return { prod, dev }
}

export const lower = (
  spec: DockerSpec
): Effect.Effect<DockerfileBundle, AnyDockerError, FileSystem | Path> =>
  Effect.gen(function*() {
    const ctx = yield* prepareContext(spec)
    yield* validateSpec({ spec, ctx })
    const pm = yield* _resolveDefaults(spec, ctx)
    yield* _checkBunFilterSupport(spec, ctx, pm)
    return buildIR({ spec, ctx, pm })
  })
