import {
  brand,
  existsOrFalse,
  findUp,
  orElseIfNotFound,
  parseYamlWith,
  readOrEmpty,
  stringRecordSchema
} from "@konfig.ts/core"
import { Effect, Match, Option, type PlatformError, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { posix, relative, resolve } from "node:path"
import {
  CircularWorkspaceDep,
  MonorepoRootNotFound,
  PackageJsonInvalid,
  UnsupportedPm,
  UnsupportedYarnLinker,
  WorkspaceConfigInvalid
} from "../DockerError"
import type { NodeModulesLayout, PmKind, YarnVariant } from "./PackageManager"
import { hasWildcard, segmentMatches } from "./workspaceGlob"

const ROOT_BRAND: unique symbol = Symbol.for("@konfig.ts/docker/RootDir")

export type RootDir = string & { readonly [ROOT_BRAND]: true }

const _brandRoot = (s: string): RootDir => brand<RootDir>(s)

const PackageJsonSchema = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String),
  workspaces: Schema.optionalKey(Schema.Union([
    Schema.Array(Schema.String),
    Schema.Struct({ packages: Schema.optionalKey(Schema.Array(Schema.String)) })
  ])),
  dependencies: Schema.optionalKey(stringRecordSchema),
  devDependencies: Schema.optionalKey(stringRecordSchema),
  peerDependencies: Schema.optionalKey(stringRecordSchema),
  scripts: Schema.optionalKey(stringRecordSchema),
  packageManager: Schema.optionalKey(Schema.String),
  engines: Schema.optionalKey(stringRecordSchema)
})

export type PackageJson = typeof PackageJsonSchema.Type

const _decodePkgJsonString = Schema.decodeEffect(Schema.fromJsonString(PackageJsonSchema))

export interface Workspace {
  readonly name: string
  readonly relDir: string
  readonly pkg: PackageJson
  readonly hasBuildScript: boolean
}

const _readStringIfExists = (input: {
  readonly fs: FileSystem
  readonly path: string
}): Effect.Effect<string | undefined, PlatformError.PlatformError> =>
  orElseIfNotFound({ effect: input.fs.readFileString(input.path), fallback: undefined })

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
  readonly yarnLayout?: NodeModulesLayout | undefined
  readonly yarnPath?: string | undefined
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

const _isRootAt = (
  env: GraphEnv
): Effect.Effect<boolean, PackageJsonInvalid | PlatformError.PlatformError, FileSystem> =>
  Effect.gen(function*() {
    const pkg = yield* _readPkgJsonIfExists(env)
    const hasPnpmYaml = yield* existsOrFalse(env.p.join(env.root, "pnpm-workspace.yaml"))

    return _isMonorepoRoot({ pkg, hasPnpmYaml })
  })

const _stopsSearchAt = (env: GraphEnv) => (dir: string): Effect.Effect<boolean, never, FileSystem> =>
  _isRootAt({ ...env, root: dir }).pipe(Effect.match({ onFailure: () => true, onSuccess: (isRoot) => isRoot }))

export const findRoot = (
  from: string
): Effect.Effect<RootDir, MonorepoRootNotFound | PackageJsonInvalid | PlatformError.PlatformError, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const p = yield* Path
    const env: GraphEnv = { fs, p, root: from }
    const found = yield* findUp({ from, test: _stopsSearchAt(env) })

    if (Option.isNone(found)) return yield* new MonorepoRootNotFound({ from })
    yield* _isRootAt({ ...env, root: found.value })

    return _brandRoot(found.value)
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
}): Effect.Effect<ReadonlyArray<string>, PlatformError.PlatformError, FileSystem> =>
  orElseIfNotFound({ effect: input.env.fs.stat(input.env.p.join(input.env.root, input.rel)), fallback: undefined })
    .pipe(
      Effect.flatMap((stat) =>
        stat?.type === "Directory"
          ? _collectDescendantDirs({ env: input.env, dir: input.rel })
          : Effect.succeed([])
      )
    )

const _collectDescendantDirs = (input: {
  readonly env: GraphEnv
  readonly dir: string
}): Effect.Effect<ReadonlyArray<string>, PlatformError.PlatformError, FileSystem> =>
  _listChildren(input).pipe(
    Effect.flatMap((children) =>
      Effect.forEach(
        children.filter(_isTraversable),
        (ch) => _descendantsIfDir({ env: input.env, rel: input.env.p.join(input.dir, ch) })
      )
    ),
    Effect.map((nested) => [input.dir, ...nested.flat()])
  )

type Listing = Effect.Effect<ReadonlyArray<string>, PlatformError.PlatformError, FileSystem>

const _listChildren = (input: { readonly env: GraphEnv; readonly dir: string }): Listing =>
  orElseIfNotFound({ effect: input.env.fs.readDirectory(input.env.p.join(input.env.root, input.dir)), fallback: [] })

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
    (d) => existsOrFalse(input.env.p.join(input.env.root, d, "package.json"))
  )

const _applyPattern = (input: {
  readonly env: GraphEnv
  readonly acc: ReadonlySet<string>
  readonly pattern: string
}): Effect.Effect<ReadonlySet<string>, PlatformError.PlatformError, FileSystem> =>
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

export const _decodeConfigYaml = <S extends Schema.Codec<unknown, unknown>>(input: {
  readonly path: string
  readonly text: string
  readonly schema: S
}): Effect.Effect<S["Type"], WorkspaceConfigInvalid> => {
  const onError = (cause: unknown) => new WorkspaceConfigInvalid({ path: input.path, cause })

  return parseYamlWith({ text: input.text, schema: Schema.Unknown, onError }).pipe(
    Effect.map((doc) => doc ?? {}),
    Effect.flatMap((doc) => Schema.decodeEffect(input.schema)(doc).pipe(Effect.mapError(onError)))
  )
}

const _parsePnpmPatterns = (input: {
  readonly path: string
  readonly text: string
}): Effect.Effect<ReadonlyArray<string>, WorkspaceConfigInvalid> =>
  _decodeConfigYaml({ ...input, schema: PnpmWorkspaceYamlSchema }).pipe(
    Effect.map((parsed): ReadonlyArray<string> => parsed.packages ?? [])
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
  PackageJsonInvalid | WorkspaceConfigInvalid | PlatformError.PlatformError,
  FileSystem
> =>
  Effect.gen(function*() {
    const pnpmPath = env.p.join(env.root, "pnpm-workspace.yaml")
    const pnpmExists = yield* existsOrFalse(pnpmPath)

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
}): Effect.Effect<YarnVariant, PlatformError.PlatformError, FileSystem> =>
  input.corepackVersion && !input.corepackVersion.startsWith("1.")
    ? Effect.succeed("berry")
    : existsOrFalse(input.env.p.join(input.env.root, ".yarnrc.yml")).pipe(
      Effect.map((exists): YarnVariant => exists ? "berry" : "classic")
    )

const YarnRcSchema = Schema.Struct({
  nodeLinker: Schema.optionalKey(Schema.String),
  yarnPath: Schema.optionalKey(Schema.String)
})

const _parseYarnRc = (input: {
  readonly path: string
  readonly text: string
}): Effect.Effect<typeof YarnRcSchema.Type, WorkspaceConfigInvalid> =>
  _decodeConfigYaml({ ...input, schema: YarnRcSchema })

const _layoutOfLinker = (linker: string | undefined): Effect.Effect<NodeModulesLayout, UnsupportedYarnLinker> =>
  Match.value(linker).pipe(
    Match.when("node-modules", () => Effect.succeed<NodeModulesLayout>("hoisted")),
    Match.when("pnpm", () => Effect.succeed<NodeModulesLayout>("isolated")),
    Match.orElse(() => Effect.fail(new UnsupportedYarnLinker({ linker: linker ?? "pnp" })))
  )

const _normalizeYarnPath = (yarnPath: string | undefined): string | undefined =>
  yarnPath === undefined ? undefined : _insideRoot(posix.normalize(yarnPath))

const _insideRoot = (normalized: string): string | undefined =>
  posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../") ? undefined : normalized

const _readYarnBerryConfig = (
  env: GraphEnv
): Effect.Effect<
  Pick<DetectedPm, "yarnLayout" | "yarnPath">,
  UnsupportedYarnLinker | WorkspaceConfigInvalid | PlatformError.PlatformError,
  FileSystem
> =>
  Effect.gen(function*() {
    const path = env.p.join(env.root, ".yarnrc.yml")
    const text = yield* readOrEmpty(path)
    const rc = yield* _parseYarnRc({ path, text })
    const yarnLayout = yield* _layoutOfLinker(rc.nodeLinker)

    return { yarnLayout, yarnPath: _normalizeYarnPath(rc.yarnPath) }
  })

const _detectPnpmLayout = (
  env: GraphEnv
): Effect.Effect<NodeModulesLayout, PlatformError.PlatformError, FileSystem> =>
  Effect.gen(function*() {
    const npmrc = yield* readOrEmpty(env.p.join(env.root, ".npmrc"))

    if (/^\s*node-linker\s*=\s*hoisted\s*$/m.test(npmrc)) return "hoisted"
    const pnpmYaml = yield* readOrEmpty(env.p.join(env.root, "pnpm-workspace.yaml"))

    return /^\s*nodeLinker:\s*hoisted\s*$/m.test(pnpmYaml) ? "hoisted" : "isolated"
  })

interface PmChoice {
  readonly kind: PmKind
  readonly version: string | undefined
}

const _finalizePm = (
  input: { readonly env: GraphEnv; readonly choice: PmChoice }
): Effect.Effect<
  DetectedPm,
  UnsupportedYarnLinker | WorkspaceConfigInvalid | PlatformError.PlatformError,
  FileSystem
> =>
  Effect.gen(function*() {
    const { env, choice } = input
    const pnpmLayout = choice.kind === "Pnpm" ? yield* _detectPnpmLayout(env) : undefined

    const yarnVariant = choice.kind === "Yarn"
      ? yield* _detectYarnVariant({ env, corepackVersion: choice.version })
      : undefined

    const berry = yarnVariant === "berry" ? yield* _readYarnBerryConfig(env) : {}

    return { kind: choice.kind, version: choice.version, pnpmLayout, yarnVariant, ...berry }
  })

const _presentLockfiles = (
  env: GraphEnv
): Effect.Effect<ReadonlyArray<PmLockfile>, PlatformError.PlatformError, FileSystem> =>
  Effect.filter(PM_LOCKFILES, (entry) => existsOrFalse(env.p.join(env.root, entry.file)))

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
): Effect.Effect<
  DetectedPm,
  UnsupportedPm | UnsupportedYarnLinker | WorkspaceConfigInvalid | PackageJsonInvalid | PlatformError.PlatformError,
  FileSystem | Path
> =>
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

const _byName = (all: ReadonlyArray<Workspace>): ReadonlyMap<string, Workspace> =>
  new Map(all.map((ws) => [ws.name, ws] as const))

const _runtimeClosure = (input: { readonly all: ReadonlyArray<Workspace>; readonly target: Workspace }) =>
  _visit({
    byName: _byName(input.all),
    includeDev: false,
    ws: input.target,
    stack: [],
    state: { visited: new Set(), order: [] }
  }).pipe(Effect.map((result) => result.order))

const _reachAll = (input: {
  readonly byName: ReadonlyMap<string, Workspace>
  readonly ws: Workspace
  readonly state: Visit
}): Visit => {
  if (input.state.visited.has(input.ws.name)) return input.state

  const entered: Visit = { ...input.state, visited: new Set([...input.state.visited, input.ws.name]) }

  const done = workspaceDeps({ ws: input.ws, names: input.byName.keys(), includeDev: true })
    .flatMap(({ to }) => input.byName.get(to) ?? [])
    .reduce((acc, dep) => _reachAll({ byName: input.byName, ws: dep, state: acc }), entered)

  return { ...done, order: [...done.order, input.ws] }
}

const _closureWithDev = (input: {
  readonly all: ReadonlyArray<Workspace>
  readonly target: Workspace
}): Effect.Effect<ReadonlyArray<Workspace>, CircularWorkspaceDep> => {
  const { order } = _reachAll({
    byName: _byName(input.all),
    ws: input.target,
    state: { visited: new Set(), order: [] }
  })

  return Effect.forEach(order, (ws) => _runtimeClosure({ all: input.all, target: ws })).pipe(Effect.as(order))
}

export const closureOf = (input: ClosureInput): Effect.Effect<ReadonlyArray<Workspace>, CircularWorkspaceDep> =>
  input.includeDev === true ? _closureWithDev(input) : _runtimeClosure(input)
