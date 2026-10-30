import { brand } from "@konfig.ts/core"
import { Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { parse as parseYaml } from "yaml"
import {
  CircularWorkspaceDep,
  MonorepoRootNotFound,
  PackageJsonInvalid,
  UnsupportedPm,
  WorkspaceNotFound
} from "../DockerError"
import type { NodeModulesLayout, PmKind, YarnVariant } from "./PackageManager"
import { hasWildcard, segmentMatches } from "./workspaceGlob"

const ROOT_BRAND: unique symbol = Symbol.for("@konfig.ts/docker/RootDir")
export type RootDir = string & { readonly [ROOT_BRAND]: true }

const _brandRoot = (s: string): RootDir => brand<RootDir>(s)

const DepRecord = Schema.Record(Schema.String, Schema.String)

const PackageJsonSchema = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String),
  workspaces: Schema.optionalKey(Schema.Union([
    Schema.Array(Schema.String),
    Schema.Struct({ packages: Schema.optionalKey(Schema.Array(Schema.String)) })
  ])),
  dependencies: Schema.optionalKey(DepRecord),
  devDependencies: Schema.optionalKey(DepRecord),
  peerDependencies: Schema.optionalKey(DepRecord),
  scripts: Schema.optionalKey(DepRecord),
  packageManager: Schema.optionalKey(Schema.String),
  engines: Schema.optionalKey(DepRecord)
})

export type PackageJson = typeof PackageJsonSchema.Type

const _decodePkgJsonString = Schema.decodeEffect(Schema.fromJsonString(PackageJsonSchema))

export interface Workspace {
  readonly name: string
  readonly relDir: string
  readonly pkg: PackageJson
  readonly hasBuildScript: boolean
}

export const existsOrFalse = (input: { readonly fs: FileSystem; readonly path: string }): Effect.Effect<boolean> =>
  input.fs.exists(input.path).pipe(Effect.orElseSucceed(() => false))

export interface DetectedPm {
  readonly kind: PmKind
  readonly version: string | undefined
  readonly pnpmLayout?: NodeModulesLayout
  readonly yarnVariant?: YarnVariant
  // Lockfiles that actually exist on disk — Bun has two formats (text
  // bun.lock, binary bun.lockb), lowering needs the one present, not both.
  readonly presentLockfiles: ReadonlyArray<string>
}

interface DecodeInput {
  readonly path: string
  readonly text: string
}

const _decodePkgJson = (input: DecodeInput): Effect.Effect<PackageJson, PackageJsonInvalid> =>
  _decodePkgJsonString(input.text).pipe(
    Effect.mapError((cause) => new PackageJsonInvalid({ path: input.path, cause }))
  )

const _readPkgJsonIfExists = (
  fs: FileSystem,
  p: Path,
  cur: string
): Effect.Effect<PackageJson | undefined, PackageJsonInvalid> =>
  Effect.gen(function*() {
    const pkgPath = p.join(cur, "package.json")
    const exists = yield* existsOrFalse({ fs, path: pkgPath })
    if (!exists) return undefined
    const text = yield* fs.readFileString(pkgPath).pipe(Effect.option)
    if (text._tag === "None") return undefined
    return yield* _decodePkgJson({ path: pkgPath, text: text.value })
  })

const _isMonorepoRoot = (pkg: PackageJson | undefined, hasPnpmYaml: boolean): boolean => {
  if (hasPnpmYaml) return true
  if (!pkg?.workspaces) return false
  return true
}

interface FsEnv {
  readonly fs: FileSystem
  readonly p: Path
}

const _searchRoot = (input: {
  readonly env: FsEnv
  readonly cur: string
  readonly remaining: number
}): Effect.Effect<RootDir | undefined, PackageJsonInvalid> =>
  Effect.gen(function*() {
    const { env, cur } = input
    const pkg = yield* _readPkgJsonIfExists(env.fs, env.p, cur)
    const pnpmYamlExists = yield* existsOrFalse({ fs: env.fs, path: env.p.join(cur, "pnpm-workspace.yaml") })
    if (_isMonorepoRoot(pkg, pnpmYamlExists)) return _brandRoot(cur)
    const parent = env.p.dirname(cur)
    if (input.remaining <= 1 || parent === cur) return undefined
    return yield* _searchRoot({ env, cur: parent, remaining: input.remaining - 1 })
  })

const MAX_ROOT_SEARCH_DEPTH = 64

export const findRoot = (
  from: string
): Effect.Effect<RootDir, MonorepoRootNotFound | PackageJsonInvalid, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const p = yield* Path
    const found = yield* _searchRoot({ env: { fs, p }, cur: p.resolve(from), remaining: MAX_ROOT_SEARCH_DEPTH })
    return found ?? (yield* new MonorepoRootNotFound({ from }))
  })

interface GlobEnv {
  readonly fs: FileSystem
  readonly p: Path
  readonly root: string
}

interface SegmentStep {
  readonly cur: string
  readonly part: string
}

const _isTraversable = (name: string): boolean => name !== "node_modules" && !name.startsWith(".")

const _descendantsIfDir = (input: {
  readonly env: GlobEnv
  readonly rel: string
}): Effect.Effect<ReadonlyArray<string>> =>
  input.env.fs.stat(input.env.p.join(input.env.root, input.rel)).pipe(
    Effect.option,
    Effect.flatMap((stat) =>
      stat._tag === "Some" && stat.value.type === "Directory"
        ? _collectDescendantDirs({ env: input.env, dir: input.rel })
        : Effect.succeed([])
    )
  )

const _collectDescendantDirs = (input: {
  readonly env: GlobEnv
  readonly dir: string
}): Effect.Effect<ReadonlyArray<string>> =>
  _listChildren(input.env, input.dir).pipe(
    Effect.flatMap((children) =>
      Effect.forEach(
        children.filter(_isTraversable),
        (ch) => _descendantsIfDir({ env: input.env, rel: input.env.p.join(input.dir, ch) })
      )
    ),
    Effect.map((nested) => [input.dir, ...nested.flat()])
  )

const _listChildren = (env: GlobEnv, dir: string): Effect.Effect<ReadonlyArray<string>> =>
  env.fs.readDirectory(env.p.join(env.root, dir)).pipe(Effect.orElseSucceed((): string[] => []))

const _wildcardChildren = (env: GlobEnv, step: SegmentStep): Effect.Effect<ReadonlyArray<string>> =>
  _listChildren(env, step.cur).pipe(
    Effect.map((children) =>
      children
        .filter((ch) => ch !== "node_modules" && segmentMatches({ segment: step.part, name: ch }))
        .map((ch) => env.p.join(step.cur, ch))
    )
  )

const _expandSegment = (env: GlobEnv, step: SegmentStep): Effect.Effect<ReadonlyArray<string>> => {
  if (step.part === "**") return _collectDescendantDirs({ env, dir: step.cur })
  if (hasWildcard(step.part)) return _wildcardChildren(env, step)
  return Effect.succeed([env.p.join(step.cur, step.part)])
}

const _expandWorkspaceGlob = (env: GlobEnv, pattern: string): Effect.Effect<ReadonlyArray<string>> =>
  Effect.reduce(
    pattern.split("/").filter((s) => s.length > 0),
    (): ReadonlyArray<string> => [""],
    (currents, part) =>
      Effect.forEach(currents, (cur) => _expandSegment(env, { cur, part })).pipe(
        Effect.map((groups) => groups.flat())
      )
  )

const _withPackageJson = (env: GlobEnv, dirs: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string>> =>
  Effect.filter(
    dirs,
    (d) => existsOrFalse({ fs: env.fs, path: env.p.join(env.root, d, "package.json") })
  )

const _applyPattern = (env: GlobEnv, acc: ReadonlySet<string>, pattern: string): Effect.Effect<ReadonlySet<string>> =>
  pattern.startsWith("!")
    ? _expandWorkspaceGlob(env, pattern.slice(1)).pipe(
      Effect.map((dirs) => new Set([...acc].filter((d) => !dirs.includes(d))))
    )
    : _expandWorkspaceGlob(env, pattern).pipe(
      Effect.flatMap((dirs) => _withPackageJson(env, dirs)),
      Effect.map((dirs) => new Set([...acc, ...dirs]))
    )

const PnpmWorkspaceYamlSchema = Schema.Struct({
  packages: Schema.optionalKey(Schema.Array(Schema.String))
})

const _isStringArray = (u: ReadonlyArray<string> | object): u is ReadonlyArray<string> => Array.isArray(u)

const _readWorkspacePatterns = (
  root: RootDir,
  fs: FileSystem,
  p: Path
): Effect.Effect<ReadonlyArray<string>, PackageJsonInvalid> =>
  Effect.gen(function*() {
    const pnpmPath = p.join(root, "pnpm-workspace.yaml")
    const pnpmExists = yield* existsOrFalse({ fs, path: pnpmPath })
    if (pnpmExists) {
      const text = yield* fs.readFileString(pnpmPath).pipe(Effect.orElseSucceed(() => ""))
      if (text === "") return []
      return yield* Effect.try((): unknown => parseYaml(text)).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(PnpmWorkspaceYamlSchema)),
        Effect.map((parsed): ReadonlyArray<string> => parsed.packages ?? []),
        Effect.orElseSucceed((): ReadonlyArray<string> => [])
      )
    }
    const pkg = yield* _readPkgJsonIfExists(fs, p, root)
    const ws = pkg?.workspaces
    if (!ws) return []
    if (_isStringArray(ws)) return ws
    return ws.packages ?? []
  })

const _parseWorkspacePackage = (
  root: RootDir,
  fs: FileSystem,
  p: Path,
  relDir: string
): Effect.Effect<Workspace | undefined, PackageJsonInvalid> =>
  Effect.gen(function*() {
    const pkgPath = p.join(root, relDir, "package.json")
    const text = yield* fs.readFileString(pkgPath).pipe(Effect.option)
    if (text._tag === "None") return undefined
    const pkg = yield* _decodePkgJson({ path: pkgPath, text: text.value })
    if (!pkg.name) return undefined
    return { name: pkg.name, relDir, pkg, hasBuildScript: Boolean(pkg.scripts?.build) }
  })

export const allWorkspaces = (
  root: RootDir
): Effect.Effect<ReadonlyArray<Workspace>, PackageJsonInvalid, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const p = yield* Path
    const env: GlobEnv = { fs, p, root }
    const patterns = yield* _readWorkspacePatterns(root, fs, p)
    const dirSet = yield* Effect.reduce(patterns, (): ReadonlySet<string> =>
      new Set<string>(), (acc, pat) =>
      _applyPattern(env, acc, pat))
    const parsed = yield* Effect.forEach([...dirSet], (d) =>
      _parseWorkspacePackage(root, fs, p, d))
    return parsed.filter((w): w is Workspace => w !== undefined).sort((a, b) => a.name.localeCompare(b.name))
  })

const _parseCorepackField = (
  pm: string
): { kind: PmKind; version: string } | undefined => {
  const at = pm.lastIndexOf("@")
  if (at < 0) return undefined
  const name = pm.slice(0, at)
  const version = pm.slice(at + 1).split("+")[0] ?? ""
  if (name === "bun") return { kind: "Bun", version }
  if (name === "npm") return { kind: "Npm", version }
  if (name === "pnpm") return { kind: "Pnpm", version }
  if (name === "yarn") return { kind: "Yarn", version }
  return undefined
}

const PM_LOCKFILES: ReadonlyArray<{ kind: PmKind; file: string }> = [
  { kind: "Bun", file: "bun.lock" },
  { kind: "Bun", file: "bun.lockb" },
  { kind: "Pnpm", file: "pnpm-lock.yaml" },
  { kind: "Npm", file: "package-lock.json" },
  { kind: "Yarn", file: "yarn.lock" }
]

const _detectYarnVariant = (
  root: RootDir,
  fs: FileSystem,
  p: Path,
  corepackVersion?: string
): Effect.Effect<YarnVariant, never> =>
  Effect.gen(function*() {
    if (corepackVersion && !corepackVersion.startsWith("1.")) return "berry"
    const yarnrcExists = yield* existsOrFalse({ fs, path: p.join(root, ".yarnrc.yml") })
    if (yarnrcExists) return "berry"
    return "classic"
  })

const _detectPnpmLayout = (
  root: RootDir,
  fs: FileSystem,
  p: Path
): Effect.Effect<NodeModulesLayout, never> =>
  Effect.gen(function*() {
    const npmrc = yield* fs
      .readFileString(p.join(root, ".npmrc"))
      .pipe(Effect.orElseSucceed(() => ""))
    if (/^\s*node-linker\s*=\s*hoisted\s*$/m.test(npmrc)) return "hoisted"
    const pnpmYaml = yield* fs
      .readFileString(p.join(root, "pnpm-workspace.yaml"))
      .pipe(Effect.orElseSucceed(() => ""))
    if (/^\s*nodeLinker:\s*hoisted\s*$/m.test(pnpmYaml)) return "hoisted"
    return "isolated"
  })

interface FinalizePmInput {
  readonly root: RootDir
  readonly kind: PmKind
  readonly version: string | undefined
  readonly presentLockfiles: ReadonlyArray<{ kind: PmKind; file: string }>
}

const _finalizePm = (input: FinalizePmInput): Effect.Effect<DetectedPm, never, FileSystem | Path> =>
  Effect.gen(function*() {
    const { root, kind, version } = input
    const fs = yield* FileSystem
    const p = yield* Path
    const layout = kind === "Pnpm" ? yield* _detectPnpmLayout(root, fs, p) : undefined
    const yarnVariant = kind === "Yarn" ? yield* _detectYarnVariant(root, fs, p, version) : undefined
    return {
      kind,
      version,
      presentLockfiles: input.presentLockfiles.filter((l) => l.kind === kind).map((l) => l.file),
      ...(layout ? { pnpmLayout: layout } : {}),
      ...(yarnVariant ? { yarnVariant } : {})
    }
  })

interface PmLockfile {
  readonly kind: PmKind
  readonly file: string
}

const _presentLockfiles = (input: {
  readonly env: FsEnv
  readonly root: RootDir
}): Effect.Effect<ReadonlyArray<PmLockfile>> =>
  Effect.filter(
    PM_LOCKFILES,
    (entry) => existsOrFalse({ fs: input.env.fs, path: input.env.p.join(input.root, entry.file) })
  )

const _kindFromLockfiles = (present: ReadonlyArray<PmLockfile>): Effect.Effect<PmKind, UnsupportedPm> => {
  const [first, ...rest] = [...new Set(present.map((l) => l.kind))]
  if (first === undefined) {
    return Effect.fail(new UnsupportedPm({ reason: "no packageManager field and no recognized lockfile" }))
  }
  return rest.length > 0
    ? Effect.fail(
      new UnsupportedPm({
        reason: "multiple lockfiles present and no packageManager field to disambiguate",
        candidates: [first, ...rest]
      })
    )
    : Effect.succeed(first)
}

interface PmChoice {
  readonly kind: PmKind
  readonly version: string | undefined
}

const _chooseKind = (input: {
  readonly corepack: PmChoice | undefined
  readonly present: ReadonlyArray<PmLockfile>
}): Effect.Effect<PmChoice, UnsupportedPm> =>
  input.corepack
    ? Effect.succeed(input.corepack)
    : _kindFromLockfiles(input.present).pipe(Effect.map((kind): PmChoice => ({ kind, version: undefined })))

export const detectPm = (
  root: RootDir
): Effect.Effect<DetectedPm, UnsupportedPm | PackageJsonInvalid, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const p = yield* Path
    const pkg = yield* _readPkgJsonIfExists(fs, p, root)
    const corepack = pkg?.packageManager ? _parseCorepackField(pkg.packageManager) : undefined
    const presentLockfiles = yield* _presentLockfiles({ env: { fs, p }, root })
    const choice = yield* _chooseKind({ corepack, present: presentLockfiles })
    return yield* _finalizePm({ root, ...choice, presentLockfiles })
  })

const _depNames = (pkg: PackageJson, includeDev: boolean): ReadonlyArray<string> =>
  [pkg.dependencies, pkg.peerDependencies, includeDev ? pkg.devDependencies : undefined].flatMap((rec) =>
    Object.keys(rec ?? {})
  )

export interface ClosureInput {
  readonly all: ReadonlyArray<Workspace>
  readonly target: string
  readonly includeDev?: boolean
}

interface Visit {
  readonly visited: ReadonlySet<string>
  readonly order: ReadonlyArray<Workspace>
}

interface VisitInput {
  readonly byName: ReadonlyMap<string, Workspace>
  readonly includeDev: boolean
  readonly ws: Workspace
  readonly stack: ReadonlyArray<string>
  readonly state: Visit
}

const _visit = (input: VisitInput): Effect.Effect<Visit, CircularWorkspaceDep> => {
  const { ws, stack, state } = input
  if (state.visited.has(ws.name)) return Effect.succeed(state)
  if (stack.includes(ws.name)) return Effect.fail(new CircularWorkspaceDep({ cycle: [...stack, ws.name] }))
  const deps = _depNames(ws.pkg, input.includeDev).flatMap((name) => {
    const dep = input.byName.get(name)
    return dep ? [dep] : []
  })
  return Effect.reduce(
    deps,
    (): Visit => state,
    (acc, dep) => _visit({ ...input, ws: dep, stack: [...stack, ws.name], state: acc })
  )
    .pipe(Effect.map((done): Visit => ({ visited: new Set([...done.visited, ws.name]), order: [...done.order, ws] })))
}

const _lookupWorkspace = (input: {
  readonly all: ReadonlyArray<Workspace>
  readonly ref: string
}): Workspace | undefined =>
  input.all.find((w) => w.name === input.ref) ?? input.all.find((w) => w.relDir === input.ref)

export const closureOf = (
  input: ClosureInput
): Effect.Effect<ReadonlyArray<Workspace>, WorkspaceNotFound | CircularWorkspaceDep> =>
  Effect.gen(function*() {
    const root = _lookupWorkspace({ all: input.all, ref: input.target })
    if (!root) return yield* new WorkspaceNotFound({ target: input.target })
    const result = yield* _visit({
      byName: new Map(input.all.map((ws) => [ws.name, ws] as const)),
      includeDev: input.includeDev ?? false,
      ws: root,
      stack: [],
      state: { visited: new Set(), order: [] }
    })
    return result.order
  })
