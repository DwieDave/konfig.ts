import { brand } from "@konfig.ts/core"
import { Effect, type PlatformError, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { relative, resolve } from "node:path"
import { parse as parseYaml } from "yaml"
import {
  CircularWorkspaceDep,
  MonorepoRootNotFound,
  PackageJsonInvalid,
  UnsupportedPm,
  WorkspaceConfigInvalid
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

const _recoverNotFound = <B>(fallback: B) =>
<A, R>(
  effect: Effect.Effect<A, PlatformError.PlatformError, R>
): Effect.Effect<A | B, PlatformError.PlatformError, R> =>
  effect.pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(fallback)))

export const existsOrFalse = (
  input: { readonly fs: FileSystem; readonly path: string }
): Effect.Effect<boolean, PlatformError.PlatformError> => input.fs.exists(input.path).pipe(_recoverNotFound(false))

const _readStringIfExists = (input: {
  readonly fs: FileSystem
  readonly path: string
}): Effect.Effect<string | undefined, PlatformError.PlatformError> =>
  input.fs.readFileString(input.path).pipe(_recoverNotFound(undefined))

interface GraphEnv {
  readonly fs: FileSystem
  readonly p: Path
  readonly root: string
}

export interface DetectedPm {
  readonly kind: PmKind
  readonly version: string | undefined
  readonly pnpmLayout?: NodeModulesLayout | undefined
  readonly yarnVariant?: YarnVariant | undefined
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
  env: GraphEnv
): Effect.Effect<PackageJson | undefined, PackageJsonInvalid | PlatformError.PlatformError> =>
  Effect.gen(function*() {
    const path = env.p.join(env.root, "package.json")
    const text = yield* _readStringIfExists({ fs: env.fs, path })

    return text === undefined ? undefined : yield* _decodePkgJson({ path, text })
  })

const _isMonorepoRoot = (input: { readonly pkg: PackageJson | undefined; readonly hasPnpmYaml: boolean }): boolean =>
  input.hasPnpmYaml || Boolean(input.pkg?.workspaces)

const _searchRoot = (input: {
  readonly env: GraphEnv
  readonly remaining: number
}): Effect.Effect<RootDir | undefined, PackageJsonInvalid | PlatformError.PlatformError> =>
  Effect.gen(function*() {
    const { env } = input
    const pkg = yield* _readPkgJsonIfExists(env)
    const hasPnpmYaml = yield* existsOrFalse({ fs: env.fs, path: env.p.join(env.root, "pnpm-workspace.yaml") })

    if (_isMonorepoRoot({ pkg, hasPnpmYaml })) return _brandRoot(env.root)
    const parent = env.p.dirname(env.root)

    if (input.remaining <= 1 || parent === env.root) return undefined

    return yield* _searchRoot({ env: { ...env, root: parent }, remaining: input.remaining - 1 })
  })

const MAX_ROOT_SEARCH_DEPTH = 64

export const findRoot = (
  from: string
): Effect.Effect<RootDir, MonorepoRootNotFound | PackageJsonInvalid | PlatformError.PlatformError, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const p = yield* Path
    const found = yield* _searchRoot({ env: { fs, p, root: p.resolve(from) }, remaining: MAX_ROOT_SEARCH_DEPTH })

    return found ?? (yield* new MonorepoRootNotFound({ from }))
  })

interface SegmentStep {
  readonly cur: string
  readonly part: string
}

interface StepInput {
  readonly env: GraphEnv
  readonly step: SegmentStep
}

const _isTraversable = (name: string): boolean => name !== "node_modules" && !name.startsWith(".")

const _descendantsIfDir = (input: {
  readonly env: GraphEnv
  readonly rel: string
}): Effect.Effect<ReadonlyArray<string>, PlatformError.PlatformError> =>
  input.env.fs.stat(input.env.p.join(input.env.root, input.rel)).pipe(
    _recoverNotFound(undefined),
    Effect.flatMap((stat) =>
      stat?.type === "Directory"
        ? _collectDescendantDirs({ env: input.env, dir: input.rel })
        : Effect.succeed([])
    )
  )

const _collectDescendantDirs = (input: {
  readonly env: GraphEnv
  readonly dir: string
}): Effect.Effect<ReadonlyArray<string>, PlatformError.PlatformError> =>
  _listChildren(input).pipe(
    Effect.flatMap((children) =>
      Effect.forEach(
        children.filter(_isTraversable),
        (ch) => _descendantsIfDir({ env: input.env, rel: input.env.p.join(input.dir, ch) })
      )
    ),
    Effect.map((nested) => [input.dir, ...nested.flat()])
  )

type Listing = Effect.Effect<ReadonlyArray<string>, PlatformError.PlatformError>

const _listChildren = (input: { readonly env: GraphEnv; readonly dir: string }): Listing =>
  input.env.fs.readDirectory(input.env.p.join(input.env.root, input.dir)).pipe(_recoverNotFound([]))

const _wildcardChildren = ({ env, step }: StepInput): Listing =>
  _listChildren({ env, dir: step.cur }).pipe(
    Effect.map((children) =>
      children
        .filter((ch) => ch !== "node_modules" && segmentMatches({ segment: step.part, name: ch }))
        .map((ch) => env.p.join(step.cur, ch))
    )
  )

const _expandSegment = ({ env, step }: StepInput): Listing => {
  if (step.part === "**") return _collectDescendantDirs({ env, dir: step.cur })

  if (hasWildcard(step.part)) return _wildcardChildren({ env, step })

  return Effect.succeed([env.p.join(step.cur, step.part)])
}

const _expandWorkspaceGlob = (input: {
  readonly env: GraphEnv
  readonly pattern: string
}): Listing =>
  Effect.reduce(
    input.pattern.split("/").filter((s) => s.length > 0),
    (): ReadonlyArray<string> => [""],
    (currents, part) =>
      Effect.forEach(currents, (cur) => _expandSegment({ env: input.env, step: { cur, part } })).pipe(
        Effect.map((groups) => groups.flat())
      )
  )

const _withPackageJson = (input: {
  readonly env: GraphEnv
  readonly dirs: ReadonlyArray<string>
}): Listing =>
  Effect.filter(
    input.dirs,
    (d) => existsOrFalse({ fs: input.env.fs, path: input.env.p.join(input.env.root, d, "package.json") })
  )

const _applyPattern = (input: {
  readonly env: GraphEnv
  readonly acc: ReadonlySet<string>
  readonly pattern: string
}): Effect.Effect<ReadonlySet<string>, PlatformError.PlatformError> =>
  input.pattern.startsWith("!")
    ? _expandWorkspaceGlob({ env: input.env, pattern: input.pattern.slice(1) }).pipe(
      Effect.map((dirs) => new Set([...input.acc].filter((d) => !dirs.includes(d))))
    )
    : _expandWorkspaceGlob({ env: input.env, pattern: input.pattern }).pipe(
      Effect.flatMap((dirs) => _withPackageJson({ env: input.env, dirs })),
      Effect.map((dirs) => new Set([...input.acc, ...dirs]))
    )

const PnpmWorkspaceYamlSchema = Schema.Struct({
  packages: Schema.optionalKey(Schema.Array(Schema.String))
})

const _isStringArray = Schema.is(Schema.Array(Schema.String))

const _parsePnpmPatterns = (input: {
  readonly path: string
  readonly text: string
}): Effect.Effect<ReadonlyArray<string>, WorkspaceConfigInvalid> =>
  input.text === ""
    ? Effect.succeed<ReadonlyArray<string>>([])
    : Effect.try(() => parseYaml(input.text)).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(PnpmWorkspaceYamlSchema)),
      Effect.map((parsed): ReadonlyArray<string> => parsed.packages ?? []),
      Effect.mapError((cause) => new WorkspaceConfigInvalid({ path: input.path, cause }))
    )

const _readPnpmPatterns = (input: {
  readonly env: GraphEnv
  readonly path: string
}): Effect.Effect<ReadonlyArray<string>, WorkspaceConfigInvalid | PlatformError.PlatformError> =>
  input.env.fs.readFileString(input.path).pipe(
    Effect.flatMap((text) => _parsePnpmPatterns({ path: input.path, text }))
  )

const _readPackageJsonPatterns = (
  env: GraphEnv
): Effect.Effect<ReadonlyArray<string>, PackageJsonInvalid | PlatformError.PlatformError> =>
  _readPkgJsonIfExists(env).pipe(
    Effect.map((pkg): ReadonlyArray<string> => {
      const ws = pkg?.workspaces

      if (!ws) return []

      return _isStringArray(ws) ? ws : (ws.packages ?? [])
    })
  )

const _readWorkspacePatterns = (
  env: GraphEnv
): Effect.Effect<
  ReadonlyArray<string>,
  PackageJsonInvalid | WorkspaceConfigInvalid | PlatformError.PlatformError
> =>
  Effect.gen(function*() {
    const pnpmPath = env.p.join(env.root, "pnpm-workspace.yaml")
    const pnpmExists = yield* existsOrFalse({ fs: env.fs, path: pnpmPath })

    return yield* (pnpmExists ? _readPnpmPatterns({ env, path: pnpmPath }) : _readPackageJsonPatterns(env))
  })

const _parseWorkspacePackage = (input: {
  readonly env: GraphEnv
  readonly relDir: string
}): Effect.Effect<Workspace | undefined, PackageJsonInvalid | PlatformError.PlatformError> =>
  Effect.gen(function*() {
    const { env, relDir } = input
    const pkgPath = env.p.join(env.root, relDir, "package.json")
    const text = yield* _readStringIfExists({ fs: env.fs, path: pkgPath })

    if (text === undefined) return undefined
    const pkg = yield* _decodePkgJson({ path: pkgPath, text })

    if (!pkg.name) return undefined

    return { name: pkg.name, relDir, pkg, hasBuildScript: Boolean(pkg.scripts?.build) }
  })

export const allWorkspaces = (
  root: RootDir
): Effect.Effect<
  ReadonlyArray<Workspace>,
  PackageJsonInvalid | WorkspaceConfigInvalid | PlatformError.PlatformError,
  FileSystem | Path
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const p = yield* Path
    const env: GraphEnv = { fs, p, root }
    const patterns = yield* _readWorkspacePatterns(env)

    const dirSet = yield* Effect.reduce(
      patterns,
      (): ReadonlySet<string> => new Set<string>(),
      (acc, pattern) => _applyPattern({ env, acc, pattern })
    )

    const parsed = yield* Effect.forEach([...dirSet], (relDir) => _parseWorkspacePackage({ env, relDir }))

    return parsed.filter((w): w is Workspace => w !== undefined).sort((a, b) => a.name.localeCompare(b.name))
  })

const COREPACK_KINDS = new Map<string, PmKind>([
  ["bun", "Bun"],
  ["npm", "Npm"],
  ["pnpm", "Pnpm"],
  ["yarn", "Yarn"]
])

const _parseCorepackField = (
  pm: string
): { kind: PmKind; version: string } | undefined => {
  const at = pm.lastIndexOf("@")

  if (at < 0) return undefined
  const kind = COREPACK_KINDS.get(pm.slice(0, at))
  const version = pm.slice(at + 1).split("+")[0] ?? ""

  return kind === undefined ? undefined : { kind, version }
}

interface PmLockfile {
  readonly kind: PmKind
  readonly file: string
}

const PM_LOCKFILES: ReadonlyArray<PmLockfile> = [
  { kind: "Bun", file: "bun.lock" },
  { kind: "Bun", file: "bun.lockb" },
  { kind: "Pnpm", file: "pnpm-lock.yaml" },
  { kind: "Npm", file: "package-lock.json" },
  { kind: "Yarn", file: "yarn.lock" }
]

const _detectYarnVariant = (input: {
  readonly env: GraphEnv
  readonly corepackVersion: string | undefined
}): Effect.Effect<YarnVariant, PlatformError.PlatformError> =>
  input.corepackVersion && !input.corepackVersion.startsWith("1.")
    ? Effect.succeed("berry")
    : existsOrFalse({ fs: input.env.fs, path: input.env.p.join(input.env.root, ".yarnrc.yml") }).pipe(
      Effect.map((exists): YarnVariant => exists ? "berry" : "classic")
    )

const _readOrEmpty = (
  input: { readonly env: GraphEnv; readonly file: string }
): Effect.Effect<string, PlatformError.PlatformError> =>
  input.env.fs.readFileString(input.env.p.join(input.env.root, input.file)).pipe(_recoverNotFound(""))

const _detectPnpmLayout = (env: GraphEnv): Effect.Effect<NodeModulesLayout, PlatformError.PlatformError> =>
  Effect.gen(function*() {
    const npmrc = yield* _readOrEmpty({ env, file: ".npmrc" })

    if (/^\s*node-linker\s*=\s*hoisted\s*$/m.test(npmrc)) return "hoisted"
    const pnpmYaml = yield* _readOrEmpty({ env, file: "pnpm-workspace.yaml" })

    return /^\s*nodeLinker:\s*hoisted\s*$/m.test(pnpmYaml) ? "hoisted" : "isolated"
  })

interface PmChoice {
  readonly kind: PmKind
  readonly version: string | undefined
}

const _finalizePm = (
  input: { readonly env: GraphEnv; readonly choice: PmChoice }
): Effect.Effect<DetectedPm, PlatformError.PlatformError> =>
  Effect.gen(function*() {
    const { env, choice } = input
    const pnpmLayout = choice.kind === "Pnpm" ? yield* _detectPnpmLayout(env) : undefined

    const yarnVariant = choice.kind === "Yarn"
      ? yield* _detectYarnVariant({ env, corepackVersion: choice.version })
      : undefined

    return { kind: choice.kind, version: choice.version, pnpmLayout, yarnVariant }
  })

const _presentLockfiles = (env: GraphEnv): Effect.Effect<ReadonlyArray<PmLockfile>, PlatformError.PlatformError> =>
  Effect.filter(PM_LOCKFILES, (entry) => existsOrFalse({ fs: env.fs, path: env.p.join(env.root, entry.file) }))

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

const _chooseKind = (input: {
  readonly corepack: PmChoice | undefined
  readonly present: ReadonlyArray<PmLockfile>
}): Effect.Effect<PmChoice, UnsupportedPm> =>
  input.corepack
    ? Effect.succeed(input.corepack)
    : _kindFromLockfiles(input.present).pipe(Effect.map((kind): PmChoice => ({ kind, version: undefined })))

export const detectPm = (
  root: RootDir
): Effect.Effect<DetectedPm, UnsupportedPm | PackageJsonInvalid | PlatformError.PlatformError, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const p = yield* Path
    const env: GraphEnv = { fs, p, root }
    const pkg = yield* _readPkgJsonIfExists(env)
    const corepack = pkg?.packageManager ? _parseCorepackField(pkg.packageManager) : undefined
    const present = yield* _presentLockfiles(env)
    const choice = yield* _chooseKind({ corepack, present })

    return yield* _finalizePm({ env, choice })
  })

export interface WorkspaceDep {
  readonly to: string
  readonly kind: "runtime" | "dev"
}

const _namesOf = (rec: Readonly<Record<string, string>> | undefined): ReadonlyArray<string> => Object.keys(rec ?? {})

export const workspaceDeps = (input: {
  readonly ws: Workspace
  readonly names: Iterable<string>
  readonly includeDev: boolean
}): ReadonlyArray<WorkspaceDep> => {
  const known = new Set(input.names)
  const runtime = [..._namesOf(input.ws.pkg.dependencies), ..._namesOf(input.ws.pkg.peerDependencies)]
  const dev = input.includeDev ? _namesOf(input.ws.pkg.devDependencies) : []
  const runtimeSet = new Set(runtime)

  const entries: ReadonlyArray<WorkspaceDep> = [
    ...runtime.map((to): WorkspaceDep => ({ to, kind: "runtime" })),
    ...dev.filter((to) => !runtimeSet.has(to)).map((to): WorkspaceDep => ({ to, kind: "dev" }))
  ]

  return entries.filter((d, i) => known.has(d.to) && entries.findIndex((e) => e.to === d.to) === i)
}

export interface ClosureInput {
  readonly all: ReadonlyArray<Workspace>
  readonly target: Workspace
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

  const deps = workspaceDeps({ ws, names: input.byName.keys(), includeDev: input.includeDev }).flatMap(({ to }) => {
    const dep = input.byName.get(to)

    return dep ? [dep] : []
  })

  return Effect.reduce(
    deps,
    (): Visit => state,
    (acc, dep) => _visit({ ...input, ws: dep, stack: [...stack, ws.name], state: acc })
  )
    .pipe(Effect.map((done): Visit => ({ visited: new Set([...done.visited, ws.name]), order: [...done.order, ws] })))
}

export const lookupWorkspace = (input: {
  readonly workspaces: ReadonlyArray<Workspace>
  readonly root: string
  readonly cwd: string
  readonly target: string
}): Workspace | undefined => {
  const rel = relative(input.root, resolve(input.cwd, input.target))

  return input.workspaces.find((w) => w.relDir === rel) ?? input.workspaces.find((w) => w.name === input.target)
}

export const closureOf = (input: ClosureInput): Effect.Effect<ReadonlyArray<Workspace>, CircularWorkspaceDep> =>
  _visit({
    byName: new Map(input.all.map((ws) => [ws.name, ws] as const)),
    includeDev: input.includeDev ?? false,
    ws: input.target,
    stack: [],
    state: { visited: new Set(), order: [] }
  }).pipe(Effect.map((result) => result.order))
