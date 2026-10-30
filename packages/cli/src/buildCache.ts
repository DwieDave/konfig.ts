import {
  existsOrFalse,
  findUp,
  orElseIfNotFound,
  readOrEmpty,
  type RenderContext,
  type ResolvedKonfigConfig,
  sha256Hex
} from "@konfig.ts/core"
import { Array as Arr, Data, Effect, Option, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import type { PlatformError } from "effect/PlatformError"
import type { EnvTarget } from "./buildEnv"
import { resolveCliPaths } from "./cliConfig"
import { envEntryPath } from "./envEntry"
import { matchesGlob } from "./globMatch"
import { walkFiles } from "./walkFiles"

class BuildCacheError extends Data.TaggedError("BuildCacheError")<{
  readonly path: string
  readonly cause: unknown
}> {}

const _sha256 = (chunks: ReadonlyArray<string | Uint8Array>): string =>
  sha256Hex(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))))

const BuildCacheEntrySchema = Schema.Struct({
  inputHash: Schema.String,
  outputHash: Schema.String,
  outDirAbs: Schema.String,
  fileCount: Schema.Finite,
  timestamp: Schema.String
})

export type BuildCacheEntry = typeof BuildCacheEntrySchema.Type

const _decodeCacheEntryJson = Schema.decodeEffect(Schema.fromJsonString(BuildCacheEntrySchema))

export const ctxSignature = (ctx: RenderContext): string => {
  const flagPairs = ctx.flags === undefined
    ? []
    : [...ctx.flags.entries()]
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .sort()

  return [
    `cluster:${ctx.cluster ?? ""}`,
    `k8sVersion:${ctx.k8sVersion ?? ""}`,
    `flags:${flagPairs.join(",")}`
  ].join("\n")
}

const _RENDER_ENV_PREFIX = /^(KONFIG|KUBESEAL)_/

const _envSignature = (env: NodeJS.ProcessEnv): string =>
  Object.entries(env)
    .filter(([key]) => _RENDER_ENV_PREFIX.test(key))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .sort()
    .join("\n")

const _hashEntry = (input: { readonly entry: string }): Effect.Effect<string, PlatformError, FileSystem> =>
  Effect.gen(function*() {
    if (!(yield* existsOrFalse(input.entry))) return ""
    const content = yield* readOrEmpty(input.entry)

    return _sha256([`entry:${input.entry}\n`, content, "\n"])
  })

const _toPosix = (input: { readonly value: string; readonly sep: string }): string =>
  input.value.split(input.sep).join("/")

interface GlobMatcherInput {
  readonly extra: string
  readonly cfg: ResolvedKonfigConfig
  readonly path: Path
}

const _globMatcher = ({ cfg, extra, path }: GlobMatcherInput) => {
  const relative = !path.isAbsolute(extra)
  const pattern = relative ? extra.replace(/^(\.\/)+/, "") : extra

  return (candidate: string): boolean =>
    matchesGlob({
      pattern,
      path: _toPosix({ value: relative ? path.relative(cfg.configDir, candidate) : candidate, sep: path.sep })
    })
}

const _GLOB_CHARS = /[*?[{]/

const _globBase = (input: { readonly pattern: string; readonly sep: string }): string =>
  Arr.takeWhile(input.pattern.split(input.sep), (seg) => !_GLOB_CHARS.test(seg)).join(input.sep) || input.sep

const _ALWAYS_SKIPPED_DIRS: ReadonlySet<string> = new Set(["node_modules", "dist", ".konfig", ".git"])

interface CollectFilesInput {
  readonly dir: string
  readonly skipDirs: ReadonlySet<string>
}

const _collectFiles = (input: CollectFilesInput) =>
  walkFiles({
    dir: input.dir,
    skipDir: ({ full, name }) => _ALWAYS_SKIPPED_DIRS.has(name) || input.skipDirs.has(full)
  }).pipe(Effect.mapError((cause) => new BuildCacheError({ path: input.dir, cause })))

const _outputDirs = (cfg: ResolvedKonfigConfig) =>
  Effect.gen(function*() {
    const path = yield* Path
    const { cacheDir } = yield* resolveCliPaths(cfg)

    return new Set([path.join(cfg.configDir, cfg.config.root, cfg.config.outDir.manifests), cacheDir])
  })

interface IncludeInput {
  readonly extra: string
  readonly cfg: ResolvedKonfigConfig
  readonly skipDirs: ReadonlySet<string>
}

const _literalIncludeFiles = (input: { readonly abs: string; readonly skipDirs: ReadonlySet<string> }) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const stat = yield* orElseIfNotFound({ effect: fs.stat(input.abs), fallback: null })

    if (stat?.type === "Directory") return yield* _collectFiles({ dir: input.abs, skipDirs: input.skipDirs })

    return stat?.type === "File" ? [input.abs] : []
  })

const _includeFiles = (input: IncludeInput) =>
  Effect.gen(function*() {
    const path = yield* Path
    const { cfg, extra, skipDirs } = input
    const abs = path.isAbsolute(extra) ? extra : path.join(cfg.configDir, extra)

    if (!_GLOB_CHARS.test(extra)) return yield* _literalIncludeFiles({ abs, skipDirs })
    const candidates = yield* _collectFiles({ dir: _globBase({ pattern: abs, sep: path.sep }), skipDirs })

    return candidates.filter(_globMatcher({ extra, cfg, path }))
  })

const _resolveCacheIncludeFiles = (cfg: ResolvedKonfigConfig) =>
  Effect.gen(function*() {
    const skipDirs = yield* _outputDirs(cfg)

    const groups = yield* Effect.forEach(cfg.config.cacheInclude ?? [], (extra) =>
      _includeFiles({ extra, cfg, skipDirs }))

    return groups.flat()
  })

// Raw bytes, not readFileString: a lossy UTF-8 decode could map distinct
// binary contents to the same string, causing a false cache hit.
const _hashFiles = (files: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem

    return yield* Effect.forEach(Arr.sort(files, (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)), (file) =>
      orElseIfNotFound({ effect: fs.readFile(file), fallback: new Uint8Array() }).pipe(
        Effect.map((content) =>
          _sha256([`file:${file}\n`, content, "\n"])
        )
      ))
  })

const _LOCKFILES = ["bun.lock", "bun.lockb", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"] as const

const _lockfilesIn = (dir: string) =>
  Effect.gen(function*() {
    const path = yield* Path

    return yield* Effect.filter(
      _LOCKFILES.map((name) => path.join(dir, name)),
      (file) => existsOrFalse(file).pipe(Effect.mapError((cause) => new BuildCacheError({ path: file, cause })))
    )
  })

// Walks up from the config dir to the nearest directory holding a lockfile:
// node_modules is never hashed, so dependency upgrades only show up here.
const _findLockfiles = (dir: string) =>
  Effect.gen(function*() {
    const found = yield* findUp({ from: dir, test: (d) => Effect.map(_lockfilesIn(d), Arr.isReadonlyArrayNonEmpty) })

    return yield* Option.match(found, { onNone: () => Effect.succeed<ReadonlyArray<string>>([]), onSome: _lockfilesIn })
  })

const _inputFiles = (cfg: ResolvedKonfigConfig) =>
  Effect.gen(function*() {
    const path = yield* Path
    const skipDirs = yield* _outputDirs(cfg)
    const root = yield* _collectFiles({ dir: path.join(cfg.configDir, cfg.config.root), skipDirs })
    const included = yield* _resolveCacheIncludeFiles(cfg)
    const lockfiles = yield* _findLockfiles(cfg.configDir)

    return Arr.dedupe([...root, ...included, ...lockfiles])
  })

// Hash is conservative: touching any file under the env root invalidates the
// cache. False negatives only, never a false positive. KONFIG_* / KUBESEAL_*
// variables are folded in because renders read them (helm cache, sealing).
export const computeInputHash = (input: EnvTarget) =>
  Effect.gen(function*() {
    const { cfg, ctx } = input
    const config = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(cfg.config)
    const entry = yield* _hashEntry({ entry: yield* envEntryPath(input) })
    const files = yield* _hashFiles(yield* _inputFiles(cfg))

    return _sha256(
      [config, `ctx:${ctxSignature(ctx)}`, `env:${_envSignature(process.env)}`, entry, ...files].map((part) =>
        `${part}\n`
      )
    )
  })

export const computeOutputHash = (
  files: ReadonlyArray<{ readonly path: string; readonly content: string }>
): string =>
  _sha256(
    Arr.sort(files, (a: { readonly path: string }, b: { readonly path: string }) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0).flatMap((f) => [`${f.path}\n`, f.content, "\n"])
  )

export const computeOnDiskOutputHash = (
  outDirAbs: string
): Effect.Effect<string, BuildCacheError, FileSystem | Path> =>
  Effect.gen(function*() {
    const paths = yield* _collectFiles({ dir: outDirAbs, skipDirs: new Set() })

    const files = yield* Effect.forEach(paths, (path) =>
      readOrEmpty(path).pipe(
        Effect.mapError((cause) => new BuildCacheError({ path, cause })),
        Effect.map((content) => ({ path, content }))
      ))

    return computeOutputHash(files)
  })

// Folds a digest of the render-context signature into the filename so builds
// for the same env but different cluster/k8sVersion/flags don't share a slot.
const _cacheFilePath = (input: EnvTarget & { readonly path: Path }): string =>
  input.path.join(
    input.cfg.configDir,
    ".konfig",
    "cache",
    `${input.envName}-${_sha256([ctxSignature(input.ctx)]).slice(0, 16)}.json`
  )

export const readCacheEntry = (input: EnvTarget) =>
  Effect.gen(function*() {
    const path = yield* Path
    const cacheFile = _cacheFilePath({ ...input, path })

    const toError = (cause: PlatformError) => new BuildCacheError({ path: cacheFile, cause })

    if (!(yield* existsOrFalse(cacheFile).pipe(Effect.mapError(toError)))) return undefined
    const text = yield* readOrEmpty(cacheFile).pipe(Effect.mapError(toError))

    if (text === "") return undefined

    // A decode failure (stale/corrupt cache file) is just a cache miss.
    const decoded = yield* Effect.option(_decodeCacheEntryJson(text))

    return Option.getOrUndefined(decoded)
  })

const _formatCacheEntry = (entry: BuildCacheEntry): string => `${JSON.stringify(entry, null, 2)}\n`

export const writeCacheEntry = (input: EnvTarget & { readonly entry: BuildCacheEntry }) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const cacheFile = _cacheFilePath({ ...input, path })
    const dir = path.dirname(cacheFile)
    yield* fs
      .makeDirectory(dir, { recursive: true })
      .pipe(Effect.mapError((cause) => new BuildCacheError({ path: dir, cause })))
    yield* fs
      .writeFileString(cacheFile, _formatCacheEntry(input.entry))
      .pipe(Effect.mapError((cause) => new BuildCacheError({ path: cacheFile, cause })))
  })
