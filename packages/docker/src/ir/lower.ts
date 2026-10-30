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
import type { ImageRef, PackageManager, PmKind } from "../services/PackageManager"
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
import type { BuildAtom, CopyAtom, DevSpec, DockerSpec, HealthcheckAtom, RunnerSpec, UserAtom } from "../spec"
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

const _pmImpl = (input: { readonly kind: PmKind; readonly ctx: LowerContext }): PackageManager =>
  Match.value(input.kind).pipe(
    Match.when("Bun", (): PackageManager => bunPm),
    Match.when("Npm", (): PackageManager => npmPm),
    Match.when("Yarn", (): PackageManager => yarnPm({ variant: input.ctx.detectedPm.yarnVariant ?? "classic" })),
    Match.when("Pnpm", (): PackageManager => pnpmPm({ layout: input.ctx.detectedPm.pnpmLayout ?? "isolated" })),
    Match.exhaustive
  )

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

const _checkWorkspaceSources = (input: ValidateSpecInput): Effect.Effect<void, WorkspaceSourceUnknown> => {
  const closureNames = new Set<string>(input.ctx.closure.map((w) => w.name))
  const missing = input.spec.runner.copy
    .flatMap((c) => (c._tag === "WorkspaceSource" ? [c.name] : []))
    .find((name) => !closureNames.has(name))
  return missing === undefined
    ? Effect.void
    : Effect.fail(new WorkspaceSourceUnknown({ target: input.ctx.target.name, missingWorkspace: missing }))
}

const _checkPlatform = (input: ValidateSpecInput): Effect.Effect<void, PlatformMultiUnsupported> => {
  const platform = input.spec.runner.platform
  return platform?._tag === "PlatformMulti"
    ? Effect.fail(new PlatformMultiUnsupported({ target: input.ctx.target.name, values: platform.values }))
    : Effect.void
}

const _checkBuildScript = (input: ValidateSpecInput): Effect.Effect<void, BuildScriptMissing> => {
  const build = input.spec.build
  return build?._tag === "BuildScript" && !input.ctx.target.pkg.scripts?.[build.script]
    ? Effect.fail(new BuildScriptMissing({ target: input.ctx.target.name, script: build.script }))
    : Effect.void
}

const _checkSharedRootFiles = (
  input: ValidateSpecInput
): Effect.Effect<void, SharedRootFileMissing, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const p = yield* Path
    yield* Effect.forEach(input.spec.sharedRootFiles ?? [], (path) =>
      existsOrFalse({ fs, path: p.join(input.ctx.root, path) }).pipe(
        Effect.flatMap((ok) =>
          ok ? Effect.void : Effect.fail(new SharedRootFileMissing({ target: input.ctx.target.name, path }))
        )
      ), { discard: true })
  })

export const validateSpec = (
  input: ValidateSpecInput
): Effect.Effect<void, AnyDockerError, FileSystem | Path> =>
  Effect.gen(function*() {
    yield* _checkWorkspaceSources(input)
    yield* _checkPlatform(input)
    yield* _checkBuildScript(input)
    yield* _checkSharedRootFiles(input)
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

const _expandWorkspaceSourceAll = (input: {
  readonly copy: ReadonlyArray<CopyAtom>
  readonly closure: ReadonlyArray<Workspace>
}): ReadonlyArray<CopyAtom> =>
  input.copy.flatMap((c): ReadonlyArray<CopyAtom> =>
    c._tag === "WorkspaceSourceAll"
      ? input.closure.map((w): CopyAtom => ({ _tag: "WorkspaceSource", name: w.name }))
      : [c]
  )

const _chownField = (chown: string | undefined): { readonly chown?: string } => (chown ? { chown } : {})

const _builderArtifactCopy = (input: {
  readonly atom: Extract<CopyAtom, { _tag: "BuilderArtifact" }>
  readonly target: Workspace
}): Instruction => ({
  _tag: "Copy",
  from: "builder",
  src: [`/app/${input.target.relDir}/${input.atom.src}`],
  dst: `/app/${input.target.relDir}/${input.atom.dst}`,
  ..._chownField(input.atom.chown)
})

const _workspaceSourceCopy = (input: {
  readonly name: string
  readonly closure: ReadonlyArray<Workspace>
}): Instruction | undefined => {
  const ws = input.closure.find((w) => w.name === input.name)
  return ws
    ? { _tag: "Copy", from: "builder", src: [`/app/${ws.relDir}`], dst: `/app/${ws.relDir}` }
    : undefined
}

const _copyPathCopy = (atom: Extract<CopyAtom, { _tag: "CopyPath" }>): Instruction => ({
  _tag: "Copy",
  ...(atom.from ? { from: atom.from } : {}),
  src: [atom.src],
  dst: atom.dst,
  ..._chownField(atom.chown)
})

const _copyAtomToInstruction = (input: {
  readonly atom: CopyAtom
  readonly ctx: LowerContext
}): Instruction | undefined =>
  Match.value(input.atom).pipe(
    Match.tag("BuilderArtifact", (atom): Instruction | undefined =>
      _builderArtifactCopy({ atom, target: input.ctx.target })),
    Match.tag("WorkspaceSource", (atom): Instruction | undefined =>
      _workspaceSourceCopy({ name: atom.name, closure: input.ctx.closure })),
    Match.tag("CopyPath", (atom): Instruction | undefined =>
      _copyPathCopy(atom)),
    Match.tag("WorkspaceSourceAll", (): Instruction | undefined =>
      undefined),
    Match.exhaustive
  )

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

const _runnerIsAlpine = (input: { readonly runner: RunnerSpec; readonly pm: PmContext }): boolean =>
  input.runner.baseImage
    ? /alpine/i.test(`${input.runner.baseImage.image}:${input.runner.baseImage.tag}`)
    : input.pm.alpine

interface PmContext {
  readonly pmKind: PmKind
  readonly pmVersion: string
  readonly pmImpl: PackageManager
  readonly runtimeImage: ImageRef
  readonly alpine: boolean
  readonly rootFiles: ReadonlyArray<string>
}

const _presentRootFiles = (
  input: { readonly root: string; readonly pm: PackageManager }
): Effect.Effect<ReadonlyArray<string>, never, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const p = yield* Path
    return yield* Effect.filter(
      [...input.pm.lockfileNames, ...input.pm.auxFiles],
      (f) => existsOrFalse({ fs, path: p.join(input.root, f) })
    )
  })

const _resolveDefaults = (
  input: { readonly spec: DockerSpec; readonly ctx: LowerContext }
): Effect.Effect<PmContext, AnyDockerError, FileSystem | Path> =>
  Effect.gen(function*() {
    const { spec, ctx } = input
    const pmKind: PmKind = _specPmKind(spec) ?? ctx.detectedPm.kind
    const runtimeKind: RuntimeKind = _specRuntimeKind(spec) ?? _defaultRuntimeFor(pmKind)
    const alpine = spec.runtime?.alpine ?? true
    const pmVersion = yield* _requireEngineVersion({ ws: ctx.target, kind: pmKind })
    const runtimeVersion = yield* _requireEngineVersion({ ws: ctx.target, kind: runtimeKind })
    const pmImpl = _pmImpl({ kind: pmKind, ctx })
    const runtimeImage = _runtimeImpl(runtimeKind).imageRef({ version: runtimeVersion, alpine })
    const rootFiles = yield* _presentRootFiles({ root: ctx.root, pm: pmImpl })
    return { pmKind, pmVersion, pmImpl, runtimeImage, alpine, rootFiles }
  })

// The bun prod-deps stage relies on `bun install --filter`.
const _checkBunFilterSupport = (input: BuildIRInput): Effect.Effect<void, BunVersionUnsupported> =>
  input.pm.pmKind === "Bun" && input.spec.runner.production && !supportsFilteredInstall(input.pm.pmVersion)
    ? Effect.fail(
      new BunVersionUnsupported({
        target: input.ctx.target.name,
        version: input.pm.pmVersion,
        minimum: `${MIN_FILTERED_INSTALL.major}.${MIN_FILTERED_INSTALL.minor}`
      })
    )
    : Effect.void

const _baseStage = (img: ImageRef): Stage => ({
  name: "base",
  from: { _tag: "FromImage", image: img.image, tag: img.tag },
  instructions: []
})

const _rootCopyInstructions = (input: { readonly ctx: LowerContext; readonly pm: PmContext }): Instruction[] => [
  { _tag: "Copy", src: ["package.json", ...input.pm.rootFiles], dst: "./" },
  ...(input.ctx.hasPatchesDir ? [{ _tag: "Copy", src: ["patches"], dst: "./patches" } satisfies Instruction] : [])
]

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

export interface BuildIRInput {
  readonly spec: DockerSpec
  readonly ctx: LowerContext
  readonly pm: PmContext
}

interface CtxPm {
  readonly ctx: LowerContext
  readonly pm: PmContext
}

// Bun installs straight from the untouched lockfile: --frozen-lockfile pins
// versions and --filter narrows to the target's closure. bun refuses a
// lockfile whose workspaces aren't all on disk, so every package.json is copied.
const _bunProdDepsInstructions = ({ ctx, pm }: CtxPm): Instruction[] => [
  ..._packageJsonCopyInstructions(ctx.allWorkspaces),
  ..._runs(pm.pmImpl.prependDepsRuns(pm.pmVersion)),
  { _tag: "Run", cmd: [..._prodInstallCmd(pm), "--filter", ctx.target.name].join(" ") }
]

// Other managers keep the lockfile only as a hint and run a non-frozen
// install (no --frozen-lockfile/--immutable/ci) against a root package.json
// trimmed to the closure.
const _rewriteProdDepsInstructions = ({ ctx, pm }: CtxPm): Instruction[] => [
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

const _prodDepsInstallInstructions = (input: CtxPm): Instruction[] =>
  input.pm.pmKind === "Bun" ? _bunProdDepsInstructions(input) : _rewriteProdDepsInstructions(input)

// Glob metacharacters stay bare so versioned store dirs such as
// node_modules/.bun/<name>@<ver> expand in the shell.
// Applied after install (not in the runner) so the deletion actually
// shrinks the layer rather than just adding a deletion marker.
const _removePathInstructions = (paths: ReadonlyArray<string> | undefined): Instruction[] =>
  (paths ?? []).map((path): Instruction => ({ _tag: "Run", cmd: `rm -rf ${shGlobQuote(path)}` }))

const _prodDepsStage = (input: BuildIRInput): Stage =>
  _stage({
    name: "prod-deps",
    instructions: [
      ..._rootCopyInstructions(input),
      ..._prodDepsInstallInstructions(input),
      ..._removePathInstructions(input.spec.runner.removePaths)
    ]
  })

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

const _installInstructions = (input: CtxPm & { readonly installCmd: ReadonlyArray<string> }): Instruction[] => [
  ..._rootCopyInstructions(input),
  ..._packageJsonCopyInstructions(input.ctx.allWorkspaces),
  ..._runs(input.pm.pmImpl.prependDepsRuns(input.pm.pmVersion)),
  { _tag: "Run", cmd: input.installCmd.join(" ") }
]

const _depsStage = (input: CtxPm): Stage =>
  _stage({
    name: "deps",
    instructions: _installInstructions({ ...input, installCmd: input.pm.pmImpl.installCommand })
  })

const _sharedRootCopies = (spec: DockerSpec): Instruction[] =>
  (spec.sharedRootFiles ?? []).map((path): Instruction => ({ _tag: "Copy", src: [path], dst: `./${path}` }))

const _closureSourceCopies = (ctx: LowerContext): Instruction[] =>
  ctx.buildClosure.map((ws): Instruction => ({ _tag: "Copy", src: [ws.relDir], dst: `./${ws.relDir}` }))

const _envWithDefault = (input: {
  readonly env: Record<string, string> | undefined
  readonly nodeEnv: string
}): Instruction | undefined => _envToInstruction({ NODE_ENV: input.nodeEnv, ...input.env })

const _optional = <A>(value: A | undefined): ReadonlyArray<A> => (value === undefined ? [] : [value])

const _depsNodeModulesCopies = (input: CtxPm): Instruction[] =>
  input.pm.pmImpl.nodeModulesLayout === "hoisted" ? [] : input.ctx.closure.map((ws): Instruction => ({
    _tag: "Copy",
    from: "deps",
    src: [`/app/${ws.relDir}/node_modules`],
    dst: `/app/${ws.relDir}/node_modules`
  }))

const _defaultBuildScript: BuildAtom = { _tag: "BuildScript", script: "build" }
const _defaultBuildNone: BuildAtom = { _tag: "BuildNone" }

const _resolveBuild = (input: { readonly spec: DockerSpec; readonly ctx: LowerContext }): BuildAtom =>
  input.spec.build ?? (input.ctx.target.hasBuildScript ? _defaultBuildScript : _defaultBuildNone)

const _buildInstructions = (input: { readonly build: BuildAtom; readonly pm: PmContext }): Instruction[] =>
  Match.value(input.build).pipe(
    Match.tag(
      "BuildScript",
      (b): Instruction[] => [{ _tag: "Run", cmd: `${input.pm.pmKind.toLowerCase()} run ${b.script}` }]
    ),
    Match.tag("BuildCommand", (b): Instruction[] => [{ _tag: "Run", cmd: shJoin(b.argv) }]),
    Match.tag("BuildNone", (): Instruction[] => []),
    Match.exhaustive
  )

const _builderStage = (input: BuildIRInput): Stage =>
  _stage({
    name: "builder",
    instructions: [
      ..._sharedRootCopies(input.spec),
      { _tag: "Copy", from: "deps", src: ["/app/node_modules"], dst: "/app/node_modules" },
      ..._depsNodeModulesCopies(input),
      ..._closureSourceCopies(input.ctx),
      { _tag: "Workdir", path: `/app/${input.ctx.target.relDir}` },
      ..._buildInstructions({ build: _resolveBuild(input), pm: input.pm })
    ]
  })

const _platformAtomToIR = (p: DockerSpec["runner"]["platform"]): Stage["platform"] =>
  Match.value(p).pipe(
    Match.when({ _tag: "PlatformLinuxAmd64" }, (): Stage["platform"] => ({ _tag: "Single", value: "linux/amd64" })),
    Match.when({ _tag: "PlatformLinuxArm64" }, (): Stage["platform"] => ({ _tag: "Single", value: "linux/arm64" })),
    Match.orElse((): Stage["platform"] => undefined)
  )

const _runnerEnvAndExposeInstructions = (runner: RunnerSpec): ReadonlyArray<Instruction> => [
  ..._optional(_envWithDefault({ env: runner.env, nodeEnv: "production" })),
  ..._exposeToInstructions(runner.expose)
]

const _usesCustomBase = (runner: RunnerSpec): boolean => runner.baseImage !== undefined

const _nodeModulesFrom = (runner: RunnerSpec): "prod-deps" | "builder" => runner.production ? "prod-deps" : "builder"

interface RunnerNodeModulesInput {
  readonly runner: RunnerSpec
  readonly ctx: LowerContext
  readonly pm: PmContext
  readonly usesWorkspaceSource: boolean
  readonly chown: { readonly chown?: string }
}

// Workspace source needs the root node_modules too, so workspace:*
// symlinks resolve at runtime.
const _runnerRootNodeModulesInstructions = (input: RunnerNodeModulesInput): ReadonlyArray<Instruction> =>
  !input.usesWorkspaceSource || _usesCustomBase(input.runner) ? [] : [{
    _tag: "Copy",
    from: _nodeModulesFrom(input.runner),
    src: ["/app/node_modules"],
    dst: "/app/node_modules",
    ...input.chown
  }]

// Under an isolated linker (e.g. bun), each workspace keeps its own
// node_modules of symlinks into the shared store; these must come from
// the same source stage as the root copy to stay consistent with it.
const _runnerWorkspaceNodeModulesInstructions = (input: RunnerNodeModulesInput): ReadonlyArray<Instruction> =>
  !input.usesWorkspaceSource || _usesCustomBase(input.runner) || input.pm.pmImpl.nodeModulesLayout === "hoisted"
    ? []
    : input.ctx.closure.map((ws): Instruction => ({
      _tag: "Copy",
      from: _nodeModulesFrom(input.runner),
      src: [`/app/${ws.relDir}/node_modules`],
      dst: `/app/${ws.relDir}/node_modules`,
      ...input.chown
    }))

const _defaultChown = (input: { readonly instr: Instruction; readonly chown: string | undefined }): Instruction =>
  input.instr._tag === "Copy" && !input.instr.chown && input.chown
    ? { ...input.instr, chown: input.chown }
    : input.instr

const _runnerCopyInstructions = (input: {
  readonly expandedCopy: ReadonlyArray<CopyAtom>
  readonly ctx: LowerContext
  readonly chown: string | undefined
}): Instruction[] =>
  input.expandedCopy.flatMap((atom) =>
    _optional(_copyAtomToInstruction({ atom, ctx: input.ctx })).map((instr) =>
      _defaultChown({ instr, chown: input.chown })
    )
  )

const _healthcheckArgv = (hc: HealthcheckAtom): ReadonlyArray<string> =>
  hc._tag === "HealthcheckHttpGet" ? ["wget", "--spider", "-q", `http://localhost:${hc.port}${hc.path}`] : hc.argv

const _runnerHealthcheckInstruction = (hc: HealthcheckAtom | undefined): Instruction | undefined =>
  hc && {
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

const _runnerFromIR = (runner: RunnerSpec): Stage["from"] =>
  runner.baseImage
    ? { _tag: "FromImage", image: runner.baseImage.image, tag: runner.baseImage.tag }
    : { _tag: "FromStage", stage: "base" }

const _runnerInstructions = (
  input: { readonly runner: RunnerSpec; readonly ctx: LowerContext; readonly pm: PmContext }
): Instruction[] => {
  const { runner, ctx, pm } = input
  const user = _userInstructions({ user: runner.user, alpine: _runnerIsAlpine({ runner, pm }) })
  const expandedCopy = _expandWorkspaceSourceAll({ copy: runner.copy, closure: ctx.closure })
  const nodeModules: RunnerNodeModulesInput = {
    runner,
    ctx,
    pm,
    usesWorkspaceSource: expandedCopy.some((c) => c._tag === "WorkspaceSource"),
    chown: _chownField(user.chown)
  }
  return [
    ..._optional(user.setupRun),
    ..._runnerEnvAndExposeInstructions(runner),
    ..._runnerRootNodeModulesInstructions(nodeModules),
    ..._runnerCopyInstructions({ expandedCopy, ctx, chown: user.chown }),
    ..._runnerWorkspaceNodeModulesInstructions(nodeModules),
    ..._optional(_runnerHealthcheckInstruction(runner.healthcheck)),
    ...(runner.entrypoint ? [{ _tag: "Entrypoint", argv: runner.entrypoint } satisfies Instruction] : []),
    ..._optional(user.user),
    { _tag: "Cmd", argv: runner.cmd }
  ]
}

const _runnerStage = (input: BuildIRInput): Stage => {
  const runner = input.spec.runner
  const platform = _platformAtomToIR(runner.platform)
  return {
    name: "runner",
    from: _runnerFromIR(runner),
    ...(platform ? { platform } : {}),
    workdir: runner.workdir,
    instructions: _runnerInstructions({ runner, ctx: input.ctx, pm: input.pm })
  }
}

// dev installs scripts (no --ignore-scripts) so binaries are usable
const _devInstallCommand = (pm: PmContext): ReadonlyArray<string> =>
  pm.pmImpl.installCommand.filter((s) => s !== "--ignore-scripts")

const _devStage = (input: BuildIRInput & { readonly dev: DevSpec }): Stage => {
  const { spec, ctx, pm, dev } = input
  return _stage({
    name: "dev",
    instructions: [
      ..._installInstructions({ ctx, pm, installCmd: _devInstallCommand(pm) }),
      ..._sharedRootCopies(spec),
      ..._closureSourceCopies(ctx),
      { _tag: "Workdir", path: dev.workdir ?? `/app/${ctx.target.relDir}` },
      ..._optional(_envWithDefault({ env: dev.env, nodeEnv: "development" })),
      ..._exposeToInstructions(dev.expose),
      { _tag: "Cmd", argv: dev.cmd }
    ]
  })
}

export const buildIR = (input: BuildIRInput): DockerfileBundle => {
  const base = _baseStage(input.pm.runtimeImage)
  const prod: Dockerfile = {
    stages: [
      base,
      _depsStage(input),
      _builderStage(input),
      ...(input.spec.runner.production ? [_prodDepsStage(input)] : []),
      _runnerStage(input)
    ]
  }
  return input.spec.dev
    ? { prod, dev: { stages: [base, _devStage({ ...input, dev: input.spec.dev })] } }
    : { prod }
}

export const lower = (
  spec: DockerSpec
): Effect.Effect<DockerfileBundle, AnyDockerError, FileSystem | Path> =>
  Effect.gen(function*() {
    const ctx = yield* prepareContext(spec)
    yield* validateSpec({ spec, ctx })
    const pm = yield* _resolveDefaults({ spec, ctx })
    yield* _checkBunFilterSupport({ spec, ctx, pm })
    return buildIR({ spec, ctx, pm })
  })
