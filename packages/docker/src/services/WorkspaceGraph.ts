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

export const findRoot = (
  from: string
): Effect.Effect<RootDir, MonorepoRootNotFound | PackageJsonInvalid, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const p = yield* Path
    let cur = p.resolve(from)
    for (let i = 0; i < 64; i++) {
      const pkg = yield* _readPkgJsonIfExists(fs, p, cur)
      const pnpmYamlExists = yield* existsOrFalse({ fs, path: p.join(cur, "pnpm-workspace.yaml") })
      if (_isMonorepoRoot(pkg, pnpmYamlExists)) return _brandRoot(cur)
      const parent = p.dirname(cur)
      if (parent === cur) break
      cur = parent
    }
    return yield* new MonorepoRootNotFound({ from })
  })

const _collectDescendantDirs = (
  fs: FileSystem,
  p: Path,
  root: string,
  dir: string
): Effect.Effect<ReadonlyArray<string>, never> =>
  Effect.gen(function*() {
    const acc: string[] = [dir]
    const children = yield* fs
      .readDirectory(p.join(root, dir))
      .pipe(Effect.orElseSucceed((): string[] => []))
    for (const ch of children) {
      if (ch === "node_modules" || ch.startsWith(".")) continue
      const childRel = p.join(dir, ch)
      const stat = yield* fs
        .stat(p.join(root, childRel))
        .pipe(Effect.option)
      if (stat._tag === "Some" && stat.value.type === "Directory") {
        const nested = yield* _collectDescendantDirs(fs, p, root, childRel)
        for (const n of nested) acc.push(n)
      }
    }
    return acc
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
  if (step.part === "**") return _collectDescendantDirs(env.fs, env.p, env.root, step.cur)
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

export const detectPm = (
  root: RootDir
): Effect.Effect<DetectedPm, UnsupportedPm | PackageJsonInvalid, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const p = yield* Path
    const pkg = yield* _readPkgJsonIfExists(fs, p, root)
    const corepack = pkg?.packageManager ? _parseCorepackField(pkg.packageManager) : undefined
    const presentLockfiles: Array<{ kind: PmKind; file: string }> = []
    for (const entry of PM_LOCKFILES) {
      const ex = yield* existsOrFalse({ fs, path: p.join(root, entry.file) })
      if (ex) presentLockfiles.push(entry)
    }
    if (corepack) {
      return yield* _finalizePm({ root, kind: corepack.kind, version: corepack.version, presentLockfiles })
    }
    const kinds = new Set(presentLockfiles.map((l) => l.kind))
    if (kinds.size === 0) {
      return yield* new UnsupportedPm({
        reason: "no packageManager field and no recognized lockfile"
      })
    }
    if (kinds.size > 1) {
      return yield* new UnsupportedPm({
        reason: "multiple lockfiles present and no packageManager field to disambiguate",
        candidates: [...kinds]
      })
    }
    const kind = [...kinds][0]!
    return yield* _finalizePm({ root, kind, version: undefined, presentLockfiles })
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

export const closureOf = (
  input: ClosureInput
): Effect.Effect<ReadonlyArray<Workspace>, WorkspaceNotFound | CircularWorkspaceDep> =>
  Effect.gen(function*() {
    const byName = new Map<string, Workspace>()
    const byRelDir = new Map<string, Workspace>()
    for (const ws of input.all) {
      byName.set(ws.name, ws)
      byRelDir.set(ws.relDir, ws)
    }
    const lookup = (ref: string): Workspace | undefined => byName.get(ref) ?? byRelDir.get(ref)
    const root = lookup(input.target)
    if (!root) return yield* new WorkspaceNotFound({ target: input.target })
    const visited = new Set<string>()
    const onStack = new Set<string>()
    const order: Workspace[] = []
    const cycleErr = (cycle: string[]): CircularWorkspaceDep => new CircularWorkspaceDep({ cycle })
    const dfs = (ws: Workspace, stack: string[]): CircularWorkspaceDep | undefined => {
      if (visited.has(ws.name)) return undefined
      if (onStack.has(ws.name)) return cycleErr([...stack, ws.name])
      onStack.add(ws.name)
      const deps = _depNames(ws.pkg, input.includeDev ?? false)
      for (const depName of deps) {
        const dep = byName.get(depName)
        if (!dep) continue
        const err = dfs(dep, [...stack, ws.name])
        if (err) return err
      }
      onStack.delete(ws.name)
      visited.add(ws.name)
      order.push(ws)
      return undefined
    }
    const err = dfs(root, [])
    if (err) return yield* err
    return order
  })
