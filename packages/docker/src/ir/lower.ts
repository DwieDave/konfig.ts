import { Effect, Match } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import {
  type AnyDockerError,
  BuildScriptMissing,
  EngineVersionMissing,
  SharedRootFileMissing,
  WorkspaceNotFound,
  WorkspaceSourceUnknown
} from "../DockerError"
import type { ImageRef, NodeModulesLayout, PackageManager } from "../services/PackageManager"
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
  findRoot,
  type RootDir,
  type Workspace
} from "../services/WorkspaceGraph"
import type { CopyAtom, DevSpec, DockerSpec, HealthcheckAtom, RunnerSpec, UserAtom } from "../spec"
import type { Dockerfile, DockerfileBundle, Instruction, Stage } from "./DockerfileIR"

// ──────────────────────────── context ────────────────────────────

export interface LowerContext {
  readonly root: RootDir
  readonly allWorkspaces: ReadonlyArray<Workspace>
  readonly closure: ReadonlyArray<Workspace>
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
    const hasPatchesDir = yield* fs
      .exists(p.join(root, "patches"))
      .pipe(Effect.orElseSucceed(() => false))
    return { root, allWorkspaces: all, closure, target, detectedPm, hasPatchesDir }
  })

// ──────────────────────────── resolution ────────────────────────────

type PmKind = "Bun" | "Npm" | "Pnpm" | "Yarn"
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
  readonly yarnVariant: "classic" | "berry"
}

const _pmImpl = (kind: PmKind, opts: PmImplOpts): PackageManager => {
  if (kind === "Bun") return bunPm
  if (kind === "Npm") return npmPm
  if (kind === "Yarn") return yarnPm({ variant: opts.yarnVariant })
  return pnpmPm({ layout: opts.layout })
}

const _runtimeImpl = (kind: RuntimeKind): Runtime => (kind === "Bun" ? bunRuntime : nodeRuntime)

const _pmEngineKey = (kind: PmKind): string => kind.toLowerCase()
const _runtimeEngineKey = (kind: RuntimeKind): string => kind.toLowerCase()

const _readEngineVersion = (ws: Workspace, key: string): string | undefined => ws.pkg.engines?.[key]

// ──────────────────────────── validation ────────────────────────────

export interface ValidateSpecInput {
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

    if (spec.build?._tag === "BuildScript") {
      const script = spec.build.script
      if (!ctx.target.pkg.scripts?.[script]) {
        return yield* new BuildScriptMissing({ target: ctx.target.name, script })
      }
    }

    for (const path of spec.sharedRootFiles ?? []) {
      const ok = yield* fs
        .exists(p.join(ctx.root, path))
        .pipe(Effect.orElseSucceed(() => false))
      if (!ok) {
        return yield* new SharedRootFileMissing({ target: ctx.target.name, path })
      }
    }
  })

// ──────────────────────────── stage building ────────────────────────────

const HARDENED_DEFAULT_USER = { uid: 1001, gid: 1001, name: "app" } as const

/**
 * POSIX-shell single-quote a token: wrap in single quotes and replace each
 * embedded single quote with the `'\''` escape sequence (close quote,
 * backslash-escaped literal quote, reopen quote). Safe for arbitrary path
 * strings inside a Dockerfile `RUN` line.
 */
const _shSingleQuote = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`

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

const _expandWorkspaceSourceAll = (
  copy: ReadonlyArray<CopyAtom>,
  closure: ReadonlyArray<Workspace>,
  target: Workspace
): ReadonlyArray<CopyAtom> => {
  const out: CopyAtom[] = []
  for (const c of copy) {
    if (c._tag === "WorkspaceSourceAll") {
      for (const w of closure) {
        if (w.name === target.name) continue
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
  if (c._tag === "WorkspaceSourceAll") return undefined // expanded earlier
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

const _userInstructions = (user: UserAtom | undefined): {
  readonly setupRun: Instruction | undefined
  readonly user: Instruction | undefined
  readonly chown: string | undefined
} => {
  const effective: UserAtom = user ?? { _tag: "UserNonRoot" }
  if (effective._tag === "UserRoot") return { setupRun: undefined, user: undefined, chown: undefined }
  const uid = effective.uid ?? HARDENED_DEFAULT_USER.uid
  const gid = effective.gid ?? HARDENED_DEFAULT_USER.gid
  const name = effective.name ?? HARDENED_DEFAULT_USER.name
  const setupRun: Instruction = {
    _tag: "Run",
    cmd: `addgroup -S -g ${gid} ${name} && adduser -S -u ${uid} -G ${name} ${name}`
  }
  return { setupRun, user: { _tag: "User", user: name }, chown: `${name}:${name}` }
}

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
}

const _resolveDefaults = (
  spec: DockerSpec,
  ctx: LowerContext
): Effect.Effect<PmContext, AnyDockerError> =>
  Effect.gen(function*() {
    const pmKind: PmKind = _specPmKind(spec) ?? ctx.detectedPm.kind
    const runtimeKind: RuntimeKind = _specRuntimeKind(spec) ?? _defaultRuntimeFor(pmKind)
    const alpine = spec.runtime?._tag === "BunRuntime" || spec.runtime?._tag === "NodeRuntime"
      ? spec.runtime.alpine ?? true
      : true
    const pmVersion = _readEngineVersion(ctx.target, _pmEngineKey(pmKind))
    if (!pmVersion) {
      return yield* new EngineVersionMissing({
        target: ctx.target.name,
        engineField: `engines.${_pmEngineKey(pmKind)}`
      })
    }
    const runtimeVersion = _readEngineVersion(ctx.target, _runtimeEngineKey(runtimeKind))
    if (!runtimeVersion) {
      return yield* new EngineVersionMissing({
        target: ctx.target.name,
        engineField: `engines.${_runtimeEngineKey(runtimeKind)}`
      })
    }
    const pm = _pmImpl(pmKind, {
      layout: ctx.detectedPm.pnpmLayout ?? "isolated",
      yarnVariant: ctx.detectedPm.yarnVariant ?? "classic"
    })
    const runtime = _runtimeImpl(runtimeKind)
    const runtimeImage = runtime.imageRef({ version: runtimeVersion, alpine })
    const depsImage = pm.depsImage({ runtimeImage, pmVersion })
    return {
      pmKind,
      runtimeKind,
      pmVersion,
      runtimeVersion,
      pmImpl: pm,
      runtimeImpl: runtime,
      runtimeImage,
      depsImage,
      alpine
    }
  })

// ──────────────────────────── prod stages ────────────────────────────

const _baseStage = (img: ImageRef): Stage => ({
  name: "base",
  from: { _tag: "FromImage", image: img.image, tag: img.tag },
  instructions: []
})

/**
 * `prod-deps` stage — only emitted when `spec.runner.production === true`.
 * Identical shape to {@link _depsStage} but appends the package manager's
 * `productionFlag` to the install command so `devDependencies` are
 * skipped. The runner then copies its `node_modules/` from this stage
 * instead of `builder`, dropping typescript / @types / lint / test
 * tooling from the runtime image.
 */
const _lockfilesToCopy = (ctx: LowerContext, pm: PmContext): ReadonlyArray<string> =>
  ctx.detectedPm.presentLockfiles.length > 0
    ? ctx.detectedPm.presentLockfiles
    : pm.pmImpl.lockfileNames

// Root `package.json` + lockfile(s) + package-manager aux files (and the
// `patches/` dir, if present) — the minimal context every stage needs
// before it can run an install. Shared by deps / prod-deps / dev stages.
const _rootCopyInstructions = (ctx: LowerContext, pm: PmContext): Instruction[] => {
  const rootFiles: ReadonlyArray<string> = [
    "package.json",
    ..._lockfilesToCopy(ctx, pm),
    ...pm.pmImpl.auxFiles
  ]
  const instructions: Instruction[] = [{ _tag: "Copy", src: rootFiles, dst: "./" }]
  if (ctx.hasPatchesDir) {
    instructions.push({ _tag: "Copy", src: ["patches"], dst: "./patches" })
  }
  return instructions
}

// Per-workspace `package.json` copies, so the package manager can resolve
// the workspace graph before workspace source is copied in.
const _packageJsonCopyInstructions = (workspaces: ReadonlyArray<Workspace>): Instruction[] =>
  workspaces.map((ws): Instruction => ({
    _tag: "Copy",
    src: [`${ws.relDir}/package.json`],
    dst: `./${ws.relDir}/`
  }))

// Restrict the root `package.json`'s `workspaces` array to ONLY the
// closure (target + transitive workspace deps) before running install.
// Without this, `bun install` (and equivalents) resolve every workspace
// listed in the original `workspaces` field — which in a monorepo means
// pulling react / tanstack / typesafe-i18n into a CronJob image, ts-node
// into a static SPA, and so on.
//
// Mutating the root package.json is done with the package manager's own
// runtime (bun / node) so we don't need jq/sed in the base image. Script
// uses DOUBLE quotes throughout so it can be wrapped in a shell
// single-quoted string in the Dockerfile without conflicts. Also wipes
// root `devDependencies` — `--production` only SKIPS installing them but
// still needs to RESOLVE them (find workspace package or version). When
// non-closure workspaces have been removed, root devDependencies like
// `@konfig.ts/argocd: workspace:*` would error out as "Workspace
// dependency not found".
const _prodDepsWorkspaceRewriteInstruction = (ctx: LowerContext, pm: PmContext): Instruction => {
  const closureRelDirs = ctx.closure.map((ws) => ws.relDir).sort()
  const rewriteScript = `const fs=require("fs"); const p=JSON.parse(fs.readFileSync("package.json","utf-8"));` +
    ` p.workspaces=${JSON.stringify(closureRelDirs)};` +
    ` delete p.devDependencies;` +
    ` fs.writeFileSync("package.json", JSON.stringify(p,null,2));`
  const runtimeBin = pm.pmKind === "Bun" ? "bun" : "node"
  return { _tag: "Run", cmd: `${runtimeBin} -e '${rewriteScript}'` }
}

// Bun re-resolves the whole graph from scratch on `bun install`, so the
// FULL-graph lockfile (which would fail validation against the trimmed
// `workspaces` set) is dropped and regenerated. For npm/pnpm/yarn we KEEP
// the lockfile and run a NON-frozen prod install (`pm.prodInstallCommand`,
// i.e. `npm install` not `npm ci`, no `--frozen-lockfile` / `--immutable`)
// so it re-resolves against the trimmed package.json using the lockfile as
// a hint. Deleting the lockfile AND running a frozen/`ci` install would
// fail for every non-bun manager. Re-resolving in a build stage is safe;
// versions float only within each workspace's existing semver ranges.
//
// Only the closure's package.json files are copied — non-closure
// workspaces were stripped from `workspaces` above so omitting their
// package.json is safe, install resolves nothing for them.
const _prodDepsInstallInstructions = (ctx: LowerContext, pm: PmContext): Instruction[] => {
  const instructions: Instruction[] = []
  if (pm.pmKind === "Bun") {
    const lockfileTokens = _lockfilesToCopy(ctx, pm).join(" ")
    instructions.push({ _tag: "Run", cmd: `rm -f ${lockfileTokens}` })
  }
  instructions.push(..._packageJsonCopyInstructions(ctx.closure))
  for (const r of pm.pmImpl.prependDepsRuns(pm.pmVersion)) {
    instructions.push({ _tag: "Run", cmd: r })
  }
  const cmd = [...pm.pmImpl.prodInstallCommand, ...pm.pmImpl.productionFlag].join(" ")
  instructions.push({ _tag: "Run", cmd })
  return instructions
}

// Applied AFTER install so paths are gone before the runner COPY happens.
// `rm` in the runner only emits deletion markers on top of the data layer
// and doesn't reduce image size. Each path gets its OWN `RUN rm -rf`
// line, robustly single-quote escaped, so spaces and shell metacharacters
// (`;`, `&`, `$`, `*`, embedded quotes, …) can't break the build or run
// unintended commands.
const _removePathInstructions = (paths: ReadonlyArray<string> | undefined): Instruction[] =>
  (paths ?? []).map((path): Instruction => ({ _tag: "Run", cmd: `rm -rf ${_shSingleQuote(path)}` }))

const _prodDepsStage = (spec: DockerSpec, ctx: LowerContext, pm: PmContext): Stage => {
  const instructions: Instruction[] = [
    ..._rootCopyInstructions(ctx, pm),
    _prodDepsWorkspaceRewriteInstruction(ctx, pm),
    ..._prodDepsInstallInstructions(ctx, pm),
    ..._removePathInstructions(spec.runner.removePaths)
  ]
  return {
    name: "prod-deps",
    from: { _tag: "FromStage", stage: "base" },
    workdir: "/app",
    instructions
  }
}

const _depsStage = (ctx: LowerContext, pm: PmContext): Stage => {
  const instructions: Instruction[] = [
    ..._rootCopyInstructions(ctx, pm),
    ..._packageJsonCopyInstructions(ctx.allWorkspaces)
  ]
  for (const r of pm.pmImpl.prependDepsRuns(pm.pmVersion)) {
    instructions.push({ _tag: "Run", cmd: r })
  }
  instructions.push({ _tag: "Run", cmd: pm.pmImpl.installCommand.join(" ") })
  return {
    name: "deps",
    from: { _tag: "FromStage", stage: "base" },
    workdir: "/app",
    instructions
  }
}

const _builderStage = (
  spec: DockerSpec,
  ctx: LowerContext,
  pm: PmContext
): Stage => {
  const instructions: Instruction[] = []
  for (const path of spec.sharedRootFiles ?? []) {
    instructions.push({ _tag: "Copy", src: [path], dst: `./${path}` })
  }
  if (pm.pmImpl.nodeModulesLayout === "hoisted") {
    instructions.push({
      _tag: "Copy",
      from: "deps",
      src: ["/app/node_modules"],
      dst: "/app/node_modules"
    })
  } else {
    instructions.push({
      _tag: "Copy",
      from: "deps",
      src: ["/app/node_modules"],
      dst: "/app/node_modules"
    })
    for (const ws of ctx.closure) {
      instructions.push({
        _tag: "Copy",
        from: "deps",
        src: [`/app/${ws.relDir}/node_modules`],
        dst: `/app/${ws.relDir}/node_modules`
      })
    }
  }
  for (const ws of ctx.closure) {
    instructions.push({ _tag: "Copy", src: [ws.relDir], dst: `./${ws.relDir}` })
  }
  instructions.push({ _tag: "Workdir", path: `/app/${ctx.target.relDir}` })
  const build = spec.build ?? (ctx.target.hasBuildScript
    ? ({ _tag: "BuildScript", script: "build" } as const)
    : ({ _tag: "BuildNone" } as const))
  if (build._tag === "BuildScript") {
    instructions.push({ _tag: "Run", cmd: `${pm.pmKind.toLowerCase()} run ${build.script}` })
  } else if (build._tag === "BuildCommand") {
    instructions.push({ _tag: "Run", cmd: build.argv.join(" ") })
  }
  return {
    name: "builder",
    from: { _tag: "FromStage", stage: "base" },
    workdir: "/app",
    instructions
  }
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
  const env = { ...runner.env }
  if (env["NODE_ENV"] === undefined) env["NODE_ENV"] = "production"
  const envInstr = _envToInstruction(env)
  return [...(envInstr ? [envInstr] : []), ..._exposeToInstructions(runner.expose)]
}

// True once the runner uses a custom base image (e.g. nginx:alpine for a
// static SPA) — the alternate base may not even have an `/app` dir and the
// caller supplies everything explicitly via `runner.copy`, so node_modules
// must NOT be auto-copied.
const _usesCustomBase = (runner: RunnerSpec): boolean => runner.baseImage !== undefined

// Source stage for node_modules copies: the slim `prod-deps` stage instead
// of `builder` when `runner.production === true`, so dev deps are
// excluded from the final image.
const _nodeModulesFrom = (runner: RunnerSpec): "prod-deps" | "builder" => runner.production ? "prod-deps" : "builder"

// When the runner pulls in any workspace source, also pull in the root
// node_modules so workspace:* symlinks (and bun's "bun"/"source" export
// condition) resolve at runtime.
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

// Under an isolated linker (e.g. bun), each workspace keeps its OWN
// node_modules — a tree of symlinks into the shared /app/node_modules/.bun
// store. The root copy above is not enough: the target app's node_modules
// is never pulled in (only its build artifacts are), so its direct deps
// would be unresolvable at runtime. Closure workspaces' node_modules must
// also come from the same source stage (not the dev `builder`) so their
// store symlinks stay consistent with the root store. `ctx.closure`
// includes the target. WorkspaceSource source copies bring the dir minus
// node_modules (dockerignored from context / overwritten here).
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
  const user = _userInstructions(runner.user)
  const expandedCopy = _expandWorkspaceSourceAll(runner.copy, ctx.closure, ctx.target)
  const usesWorkspaceSource = expandedCopy.some((c) => c._tag === "WorkspaceSource")
  const chown = user.chown ? { chown: user.chown } : {}
  const healthcheck = _runnerHealthcheckInstruction(runner.healthcheck)
  // runner.removePaths is applied IN the source stage (prod-deps or
  // builder) so the deletion shrinks layer size — NOT here. See
  // _prodDepsStage / _builderStage.
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

// ──────────────────────────── dev stage ────────────────────────────

const _devStage = (spec: DockerSpec, ctx: LowerContext, pm: PmContext, dev: DevSpec): Stage => {
  const instructions: Instruction[] = [
    ..._rootCopyInstructions(ctx, pm),
    ..._packageJsonCopyInstructions(ctx.allWorkspaces)
  ]
  for (const r of pm.pmImpl.prependDepsRuns(pm.pmVersion)) {
    instructions.push({ _tag: "Run", cmd: r })
  }
  // dev installs scripts (no --ignore-scripts) so binaries are usable
  const devInstall = pm.pmImpl.installCommand.filter((s) => s !== "--ignore-scripts")
  instructions.push({ _tag: "Run", cmd: devInstall.join(" ") })
  for (const path of spec.sharedRootFiles ?? []) {
    instructions.push({ _tag: "Copy", src: [path], dst: `./${path}` })
  }
  for (const ws of ctx.closure) {
    instructions.push({ _tag: "Copy", src: [ws.relDir], dst: `./${ws.relDir}` })
  }
  instructions.push({ _tag: "Workdir", path: dev.workdir ?? `/app/${ctx.target.relDir}` })
  const env = { ...dev.env }
  if (env["NODE_ENV"] === undefined) env["NODE_ENV"] = "development"
  const envInstr = _envToInstruction(env)
  if (envInstr) instructions.push(envInstr)
  instructions.push(..._exposeToInstructions(dev.expose))
  instructions.push({ _tag: "Cmd", argv: dev.cmd })
  return {
    name: "dev",
    from: { _tag: "FromStage", stage: "base" },
    workdir: "/app",
    instructions
  }
}

// ──────────────────────────── buildIR (pure) ────────────────────────────

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

// ──────────────────────────── public lower ────────────────────────────

export const lower = (
  spec: DockerSpec
): Effect.Effect<DockerfileBundle, AnyDockerError, FileSystem | Path> =>
  Effect.gen(function*() {
    const ctx = yield* prepareContext(spec)
    yield* validateSpec({ spec, ctx })
    const pm = yield* _resolveDefaults(spec, ctx)
    return buildIR({ spec, ctx, pm })
  })
