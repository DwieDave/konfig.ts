import { Array as Arr, Effect, Match, Schema, Struct } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { posix } from "node:path"
import {
  type AnyDockerError,
  BuildScriptMissing,
  BunVersionUnsupported,
  EngineVersionInvalid,
  EngineVersionMissing,
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
  lookupWorkspace,
  type RootDir,
  type Workspace
} from "../services/WorkspaceGraph"
import {
  BuildAtom,
  CopyAtom,
  type DevSpec,
  type DockerSpec,
  EngineVersion,
  HealthcheckAtom,
  PackageManagerAtom,
  type RunnerSpec,
  UserAtom
} from "../spec"
import { MIN_FILTERED_INSTALL, supportsFilteredInstall } from "./bunVersion"
import {
  type Dockerfile,
  type DockerfileBundle,
  FromOf,
  HealthOf,
  Instr,
  type Instruction,
  PlatformOf,
  type Stage
} from "./DockerfileIR"
import { shGlobQuote, shJoin } from "./shell"

interface LowerContext {
  readonly root: RootDir
  readonly allWorkspaces: ReadonlyArray<Workspace>
  readonly closure: ReadonlyArray<Workspace>
  readonly buildClosure: ReadonlyArray<Workspace>
  readonly target: Workspace
  readonly detectedPm: DetectedPm
  readonly hasPatchesDir: boolean
}

export interface LowerInput {
  readonly spec: DockerSpec
  readonly target: string
}

const _prepareContext = (
  input: LowerInput
): Effect.Effect<LowerContext, AnyDockerError, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const p = yield* Path
    const root = yield* findRoot(input.target)
    const all = yield* allWorkspaces(root)
    const target = lookupWorkspace({ all, ref: input.target, root })

    if (!target) return yield* new WorkspaceNotFound({ target: input.target })
    const detectedPm = yield* detectPm(root)
    const closure = yield* closureOf({ all, target })
    const buildClosure = yield* closureOf({ all, target, includeDev: true })
    const hasPatchesDir = yield* existsOrFalse({ fs, path: p.join(root, "patches") })

    return { root, allWorkspaces: all, closure, buildClosure, target, detectedPm, hasPatchesDir }
  })

type RuntimeKind = "Bun" | "Node"

const _specRuntimeKind = (s: DockerSpec): RuntimeKind | undefined =>
  Match.value(s.runtime?._tag).pipe(
    Match.when("BunRuntime", (): RuntimeKind => "Bun"),
    Match.when("NodeRuntime", (): RuntimeKind => "Node"),
    Match.orElse((): RuntimeKind | undefined => undefined)
  )

const _defaultRuntimeFor = (pm: PmKind): RuntimeKind => (pm === "Bun" ? "Bun" : "Node")

const _atomOfKind = (kind: PmKind): PackageManagerAtom =>
  Match.value(kind).pipe(
    Match.when("Bun", (): PackageManagerAtom => PackageManagerAtom.cases.BunPm.make({})),
    Match.when("Npm", (): PackageManagerAtom => PackageManagerAtom.cases.NpmPm.make({})),
    Match.when("Pnpm", (): PackageManagerAtom => PackageManagerAtom.cases.PnpmPm.make({})),
    Match.when("Yarn", (): PackageManagerAtom => PackageManagerAtom.cases.YarnPm.make({})),
    Match.exhaustive
  )

export const pmFromAtom = (input: {
  readonly atom: PackageManagerAtom
  readonly detected: DetectedPm
}): PackageManager =>
  Match.value(input.atom).pipe(
    Match.tag("BunPm", (): PackageManager => bunPm),
    Match.tag("NpmPm", (): PackageManager => npmPm),
    Match.tag("PnpmPm", (): PackageManager => pnpmPm({ layout: input.detected.pnpmLayout ?? "isolated" })),
    Match.tag(
      "YarnPm",
      (atom): PackageManager => yarnPm({ variant: atom.variant ?? input.detected.yarnVariant ?? "classic" })
    ),
    Match.exhaustive
  )

const _runtimeImpl = (kind: RuntimeKind): Runtime => (kind === "Bun" ? bunRuntime : nodeRuntime)

const _engineKey = (kind: PmKind | RuntimeKind): string => kind.toLowerCase()

interface EngineInput {
  readonly ws: Workspace
  readonly kind: PmKind | RuntimeKind
  readonly fallback?: string | undefined
}

const _decodeEngineVersion = Schema.decodeUnknownEffect(EngineVersion)

const _requireEngineVersion = (
  input: EngineInput
): Effect.Effect<string, EngineVersionMissing | EngineVersionInvalid> => {
  const key = _engineKey(input.kind)
  const engineField = `engines.${key}`
  const version = input.ws.pkg.engines?.[key] ?? input.fallback

  return version
    ? _decodeEngineVersion(version).pipe(
      Effect.mapError(() => new EngineVersionInvalid({ target: input.ws.name, engineField, value: version }))
    )
    : Effect.fail(new EngineVersionMissing({ target: input.ws.name, engineField }))
}

interface ValidateSpecInput {
  readonly spec: DockerSpec
  readonly ctx: LowerContext
}

const _checkWorkspaceSources = (input: ValidateSpecInput): Effect.Effect<void, WorkspaceSourceUnknown> => {
  const closureNames = new Set<string>(input.ctx.closure.map((w) => w.name))

  const missing = input.spec.runner.copy
    .flatMap((c) => (CopyAtom.guards.WorkspaceSource(c) ? [c.name] : []))
    .find((name) => !closureNames.has(name))

  return missing === undefined
    ? Effect.void
    : Effect.fail(new WorkspaceSourceUnknown({ target: input.ctx.target.name, missingWorkspace: missing }))
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

const _validateSpec = (
  input: ValidateSpecInput
): Effect.Effect<void, AnyDockerError, FileSystem | Path> =>
  Effect.gen(function*() {
    yield* _checkWorkspaceSources(input)
    yield* _checkBuildScript(input)
    yield* _checkSharedRootFiles(input)
  })

const HARDENED_DEFAULT_USER = { uid: 1001, gid: 1001, name: "app" } as const

const _envToInstruction = (env: Record<string, string> | undefined): Instruction | undefined => {
  if (!env) return undefined
  const entries = Object.entries(env).sort(([a], [b]) => a.localeCompare(b))

  if (entries.length === 0) return undefined

  return Instr.Env({ entries })
}

const _exposeToInstructions = (
  expose: number | ReadonlyArray<number> | undefined
): ReadonlyArray<Instruction> => {
  if (expose === undefined) return []

  return Arr.ensure(expose).map((port): Instruction => Instr.Expose({ port }))
}

const _expandWorkspaceSourceAll = (input: {
  readonly copy: ReadonlyArray<CopyAtom>
  readonly closure: ReadonlyArray<Workspace>
}): ReadonlyArray<CopyAtom> =>
  input.copy.flatMap((c): ReadonlyArray<CopyAtom> =>
    CopyAtom.guards.WorkspaceSourceAll(c)
      ? input.closure.map((w): CopyAtom => CopyAtom.cases.WorkspaceSource.make({ name: w.name }))
      : [c]
  )

const _chownField = (chown: string | undefined): { readonly chown?: string } => (chown ? { chown } : {})

type ChownField = ReturnType<typeof _chownField>

const _builderArtifactCopy = (input: {
  readonly atom: Extract<CopyAtom, { _tag: "BuilderArtifact" }>
  readonly target: Workspace
}): Instruction =>
  Instr.Copy({
    from: "builder",
    src: [`/app/${input.target.relDir}/${input.atom.src}`],
    dst: posix.isAbsolute(input.atom.dst) ? input.atom.dst : `/app/${input.target.relDir}/${input.atom.dst}`,
    ...Struct.pick(input.atom, ["chown"])
  })

const _workspaceSourceCopy = (input: {
  readonly name: string
  readonly closure: ReadonlyArray<Workspace>
}): Instruction | undefined => {
  const ws = input.closure.find((w) => w.name === input.name)

  return ws
    ? Instr.Copy({ from: "builder", src: [`/app/${ws.relDir}`], dst: `/app/${ws.relDir}` })
    : undefined
}

const _copyPathCopy = (atom: Extract<CopyAtom, { _tag: "CopyPath" }>): Instruction =>
  Instr.Copy({ src: [atom.src], dst: atom.dst, ...Struct.pick(atom, ["from", "chown"]) })

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

interface UserInstructions {
  readonly setupRun: Instruction | undefined
  readonly user: Instruction | undefined
  readonly chown: string | undefined
}

const _userInstructions = (input: UserInput): UserInstructions => {
  const effective: UserAtom = input.user ?? UserAtom.cases.UserNonRoot.make({})

  if (UserAtom.guards.UserRoot(effective)) return { setupRun: undefined, user: undefined, chown: undefined }

  const ids: AccountIds = {
    uid: effective.uid ?? HARDENED_DEFAULT_USER.uid,
    gid: effective.gid ?? HARDENED_DEFAULT_USER.gid,
    name: effective.name ?? HARDENED_DEFAULT_USER.name
  }

  const cmd = input.alpine ? _alpineAccountCmd(ids) : _debianAccountCmd(ids)

  return {
    setupRun: Instr.Run({ cmd }),
    user: Instr.User({ user: ids.name }),
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
  readonly runtimeKind: RuntimeKind
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

    const pmImpl = pmFromAtom({
      atom: spec.packageManager ?? _atomOfKind(ctx.detectedPm.kind),
      detected: ctx.detectedPm
    })

    const pmKind = pmImpl.kind
    const runtimeKind: RuntimeKind = _specRuntimeKind(spec) ?? _defaultRuntimeFor(pmKind)
    const alpine = spec.runtime?.alpine ?? true

    const pmVersion = yield* _requireEngineVersion({
      ws: ctx.target,
      kind: pmKind,
      fallback: ctx.detectedPm.kind === pmKind ? ctx.detectedPm.version : undefined
    })

    const runtimeVersion = yield* _requireEngineVersion({ ws: ctx.target, kind: runtimeKind })
    const runtimeImage = _runtimeImpl(runtimeKind).imageRef({ version: runtimeVersion, alpine })
    const rootFiles = yield* _presentRootFiles({ root: ctx.root, pm: pmImpl })

    return { pmKind, pmVersion, pmImpl, runtimeKind, runtimeImage, alpine, rootFiles }
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
  from: FromOf.FromImage({ image: img.image, tag: img.tag }),
  instructions: []
})

const _rootCopyInstructions = (input: { readonly ctx: LowerContext; readonly pm: PmContext }): Instruction[] => [
  Instr.Copy({ src: ["package.json", ...input.pm.rootFiles], dst: "./" }),
  ...(input.ctx.hasPatchesDir ? [Instr.Copy({ src: ["patches"], dst: "./patches" })] : [])
]

const _packageJsonCopyInstructions = (workspaces: ReadonlyArray<Workspace>): Instruction[] =>
  workspaces.map((ws): Instruction => Instr.Copy({ src: [`${ws.relDir}/package.json`], dst: `./${ws.relDir}/` }))

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

  return Instr.Run({ cmd: `node -e '${rewriteScript}'` })
}

interface BuildIRInput {
  readonly spec: DockerSpec
  readonly ctx: LowerContext
  readonly pm: PmContext
}

interface CtxPm {
  readonly ctx: LowerContext
  readonly pm: PmContext
}

// Targeted managers install straight from the untouched lockfile, narrowed
// to the target's closure. They refuse a lockfile whose workspaces aren't all
// on disk, so every package.json is copied.
const _targetedProdDepsInstructions = (
  input: CtxPm & {
    readonly command: (target: string) => ReadonlyArray<string>
  }
): Instruction[] => [
  ..._packageJsonCopyInstructions(input.ctx.allWorkspaces),
  ..._runs(input.pm.pmImpl.prependDepsRuns(input.pm.pmVersion)),
  Instr.Run({ cmd: input.command(input.ctx.target.name).join(" ") })
]

// Other managers keep the lockfile only as a hint and run a non-frozen
// install (no --frozen-lockfile/--immutable/ci) against a root package.json
// trimmed to the closure.
const _rewriteProdDepsInstructions = (input: CtxPm & { readonly command: ReadonlyArray<string> }): Instruction[] => [
  _prodDepsWorkspaceRewriteInstruction(input.ctx),
  ..._packageJsonCopyInstructions(input.ctx.closure),
  ..._runs(input.pm.pmImpl.prependDepsRuns(input.pm.pmVersion)),
  Instr.Run({ cmd: input.command.join(" ") })
]

const _runs = (cmds: ReadonlyArray<string>): Instruction[] => cmds.map((cmd): Instruction => Instr.Run({ cmd }))

const _prodDepsInstallInstructions = (input: CtxPm): Instruction[] =>
  Match.value(input.pm.pmImpl.prodInstall).pipe(
    Match.tag("Targeted", ({ command }): Instruction[] => _targetedProdDepsInstructions({ ...input, command })),
    Match.tag("Rewrite", ({ command }): Instruction[] => _rewriteProdDepsInstructions({ ...input, command })),
    Match.exhaustive
  )

// Glob metacharacters stay bare so versioned store dirs such as
// node_modules/.bun/<name>@<ver> expand in the shell.
// Applied after install (not in the runner) so the deletion actually
// shrinks the layer rather than just adding a deletion marker.
const _removePathInstructions = (paths: ReadonlyArray<string> | undefined): Instruction[] =>
  (paths ?? []).map((path): Instruction => Instr.Run({ cmd: `rm -rf ${shGlobQuote(path)}` }))

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
  from: FromOf.FromStage({ stage: "base" }),
  workdir: "/app",
  instructions: input.instructions
})

const _installInstructions = (input: CtxPm & { readonly installCmd: ReadonlyArray<string> }): Instruction[] => [
  ..._rootCopyInstructions(input),
  ..._packageJsonCopyInstructions(input.ctx.allWorkspaces),
  ..._runs(input.pm.pmImpl.prependDepsRuns(input.pm.pmVersion)),
  Instr.Run({ cmd: input.installCmd.join(" ") })
]

const _depsStage = (input: CtxPm): Stage =>
  _stage({
    name: "deps",
    instructions: _installInstructions({ ...input, installCmd: input.pm.pmImpl.installCommand })
  })

const _sharedRootCopies = (spec: DockerSpec): Instruction[] =>
  (spec.sharedRootFiles ?? []).map((path): Instruction => Instr.Copy({ src: [path], dst: `./${path}` }))

const _closureSourceCopies = (ctx: LowerContext): Instruction[] =>
  ctx.buildClosure.map((ws): Instruction => Instr.Copy({ src: [ws.relDir], dst: `./${ws.relDir}` }))

const _envWithDefault = (input: {
  readonly env: Record<string, string> | undefined
  readonly nodeEnv: string
}): Instruction | undefined => _envToInstruction({ NODE_ENV: input.nodeEnv, ...input.env })

const _optional = <A>(value: A | undefined): ReadonlyArray<A> => (value === undefined ? [] : [value])

const _depsNodeModulesCopies = (input: CtxPm): Instruction[] =>
  input.pm.pmImpl.nodeModulesLayout === "hoisted" ? [] : input.ctx.closure.map((ws): Instruction =>
    Instr.Copy({
      from: "deps",
      src: [`/app/${ws.relDir}/node_modules`],
      dst: `/app/${ws.relDir}/node_modules`
    })
  )

const _defaultBuildScript: BuildAtom = BuildAtom.cases.BuildScript.make({ script: "build" })
const _defaultBuildNone: BuildAtom = BuildAtom.cases.BuildNone.make({})

const _resolveBuild = (input: { readonly spec: DockerSpec; readonly ctx: LowerContext }): BuildAtom =>
  input.spec.build ?? (input.ctx.target.hasBuildScript ? _defaultBuildScript : _defaultBuildNone)

const _buildInstructions = (input: { readonly build: BuildAtom; readonly pm: PmContext }): Instruction[] =>
  Match.value(input.build).pipe(
    Match.tag(
      "BuildScript",
      (b): Instruction[] => [Instr.Run({ cmd: `${input.pm.pmKind.toLowerCase()} run ${b.script}` })]
    ),
    Match.tag("BuildCommand", (b): Instruction[] => [Instr.Run({ cmd: shJoin(b.argv) })]),
    Match.tag("BuildNone", (): Instruction[] => []),
    Match.exhaustive
  )

const _builderStage = (input: BuildIRInput): Stage =>
  _stage({
    name: "builder",
    instructions: [
      ..._sharedRootCopies(input.spec),
      Instr.Copy({ from: "deps", src: ["/app/node_modules"], dst: "/app/node_modules" }),
      ..._depsNodeModulesCopies(input),
      ..._closureSourceCopies(input.ctx),
      Instr.Workdir({ path: `/app/${input.ctx.target.relDir}` }),
      ..._buildInstructions({ build: _resolveBuild(input), pm: input.pm })
    ]
  })

const _platformAtomToIR = (p: DockerSpec["runner"]["platform"]): Stage["platform"] =>
  Match.value(p).pipe(
    Match.when({ _tag: "PlatformLinuxAmd64" }, (): Stage["platform"] => PlatformOf.Single({ value: "linux/amd64" })),
    Match.when({ _tag: "PlatformLinuxArm64" }, (): Stage["platform"] => PlatformOf.Single({ value: "linux/arm64" })),
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
  readonly chown: ChownField
}

// Workspace source needs the root node_modules too, so workspace:*
// symlinks resolve at runtime.
const _runnerRootNodeModulesInstructions = (input: RunnerNodeModulesInput): ReadonlyArray<Instruction> =>
  !input.usesWorkspaceSource || _usesCustomBase(input.runner) ? [] : [Instr.Copy({
    from: _nodeModulesFrom(input.runner),
    src: ["/app/node_modules"],
    dst: "/app/node_modules",
    ...input.chown
  })]

// Under an isolated linker (e.g. bun), each workspace keeps its own
// node_modules of symlinks into the shared store; these must come from
// the same source stage as the root copy to stay consistent with it.
const _runnerWorkspaceNodeModulesInstructions = (input: RunnerNodeModulesInput): ReadonlyArray<Instruction> =>
  !input.usesWorkspaceSource || _usesCustomBase(input.runner) || input.pm.pmImpl.nodeModulesLayout === "hoisted"
    ? []
    : input.ctx.closure.map((ws): Instruction =>
      Instr.Copy({
        from: _nodeModulesFrom(input.runner),
        src: [`/app/${ws.relDir}/node_modules`],
        dst: `/app/${ws.relDir}/node_modules`,
        ...input.chown
      })
    )

const _defaultChown = (input: { readonly instr: Instruction; readonly chown: string | undefined }): Instruction =>
  Instr.$is("Copy")(input.instr) && !input.instr.chown && input.chown
    ? Instr.Copy({ ...input.instr, chown: input.chown })
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

const _probeScript = (url: string): string =>
  `fetch(${JSON.stringify(url)}).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))`

interface ProbeEnv {
  readonly alpine: boolean
  readonly runtimeKind: RuntimeKind
}

const _httpProbeArgv = (input: { readonly url: string; readonly probe: ProbeEnv }): ReadonlyArray<string> =>
  input.probe.alpine
    ? ["wget", "--spider", "-q", input.url]
    : [input.probe.runtimeKind === "Bun" ? "bun" : "node", "-e", _probeScript(input.url)]

const _healthcheckArgv = (input: { readonly hc: HealthcheckAtom; readonly probe: ProbeEnv }): ReadonlyArray<string> =>
  HealthcheckAtom.guards.HealthcheckHttpGet(input.hc)
    ? _httpProbeArgv({ url: `http://localhost:${input.hc.port}${input.hc.path}`, probe: input.probe })
    : input.hc.argv

const _runnerHealthcheckInstruction = (input: {
  readonly hc: HealthcheckAtom | undefined
  readonly probe: ProbeEnv
}): Instruction | undefined =>
  input.hc === undefined ? undefined : Instr.Healthcheck({
    check: HealthOf.Cmd({
      argv: _healthcheckArgv({ hc: input.hc, probe: input.probe }),
      ...Struct.pick(input.hc, ["interval", "timeout", "retries", "startPeriod"])
    })
  })

const _runnerFromIR = (runner: RunnerSpec): Stage["from"] =>
  runner.baseImage
    ? FromOf.FromImage({ image: runner.baseImage.image, tag: runner.baseImage.tag })
    : FromOf.FromStage({ stage: "base" })

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
    usesWorkspaceSource: expandedCopy.some(CopyAtom.guards.WorkspaceSource),
    chown: _chownField(user.chown)
  }

  return [
    ..._optional(user.setupRun),
    ..._runnerEnvAndExposeInstructions(runner),
    ..._runnerRootNodeModulesInstructions(nodeModules),
    ..._runnerCopyInstructions({ expandedCopy, ctx, chown: user.chown }),
    ..._runnerWorkspaceNodeModulesInstructions(nodeModules),
    ..._optional(_runnerHealthcheckInstruction({
      hc: runner.healthcheck,
      probe: { alpine: _runnerIsAlpine({ runner, pm }), runtimeKind: pm.runtimeKind }
    })),
    ..._optional(runner.entrypoint === undefined ? undefined : Instr.Entrypoint({ argv: runner.entrypoint })),
    ..._optional(user.user),
    Instr.Cmd({ argv: runner.cmd })
  ]
}

const _runnerStage = (input: BuildIRInput): Stage => {
  const runner = input.spec.runner
  const platform = _platformAtomToIR(runner.platform)

  const stage: Stage = {
    name: "runner",
    from: _runnerFromIR(runner),
    workdir: runner.workdir,
    instructions: _runnerInstructions({ runner, ctx: input.ctx, pm: input.pm })
  }

  return platform ? { ...stage, platform } : stage
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
      Instr.Workdir({ path: dev.workdir ?? `/app/${ctx.target.relDir}` }),
      ..._optional(_envWithDefault({ env: dev.env, nodeEnv: "development" })),
      ..._exposeToInstructions(dev.expose),
      Instr.Cmd({ argv: dev.cmd })
    ]
  })
}

const _buildIR = (input: BuildIRInput): DockerfileBundle => {
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
  input: LowerInput
): Effect.Effect<DockerfileBundle, AnyDockerError, FileSystem | Path> =>
  Effect.gen(function*() {
    const ctx = yield* _prepareContext(input)
    const { spec } = input
    yield* _validateSpec({ spec, ctx })
    const pm = yield* _resolveDefaults({ spec, ctx })
    yield* _checkBunFilterSupport({ spec, ctx, pm })

    return _buildIR({ spec, ctx, pm })
  })
