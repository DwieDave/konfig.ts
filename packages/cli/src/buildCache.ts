import { DEFAULT_HELM_CACHE_DIR, type RenderContext, type ResolvedKonfigConfig } from "@konfig.ts/core"
import { Data, Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import type { PlatformError } from "effect/PlatformError"
import * as crypto from "node:crypto"
import { envEntryPath } from "./envEntry"
import { matchesGlob } from "./globMatch"
import { walkFiles } from "./walkFiles"

class BuildCacheError extends Data.TaggedError("BuildCacheError")<{
  readonly path: string
  readonly cause: unknown
}> {}

// Only NotFound falls back to `onAbsent`; other I/O errors must propagate or an
// unreadable file could silently hash as absent and produce a false cache hit.
const _orAbsentIfNotFound = <A, R>(
  effect: Effect.Effect<A, PlatformError, R>,
  onAbsent: () => A
): Effect.Effect<A, PlatformError, R> =>
  effect.pipe(
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(onAbsent()))
  )

const BuildCacheEntrySchema = Schema.Struct({
  inputHash: Schema.String,
  outputHash: Schema.String,
  outDirAbs: Schema.String,
  fileCount: Schema.Finite,
  timestamp: Schema.String
})

export type BuildCacheEntry = typeof BuildCacheEntrySchema.Type

const _decodeCacheEntryJson = Schema.decodeEffect(Schema.fromJsonString(BuildCacheEntrySchema))

interface ComputeInputHashInput {
  readonly cfg: ResolvedKonfigConfig
  readonly envName: string
  readonly ctx: RenderContext
}

export const _ctxSignature = (ctx: RenderContext): string => {
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

const _hashEntry = (
  hash: crypto.Hash,
  fs: FileSystem,
  entry: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*() {
    const entryExists = yield* _orAbsentIfNotFound(fs.exists(entry), () => false)

    if (!entryExists) return
    const content = yield* _orAbsentIfNotFound(fs.readFileString(entry), () => "")
    hash.update(`entry:${entry}\n`)
    hash.update(content)
    hash.update("\n")
  })

const _toPosix = (value: string, sep: string): string => value.split(sep).join("/")

const _globMatcher = (extra: string, cfg: ResolvedKonfigConfig, path: Path) => {
  const relative = !path.isAbsolute(extra)
  const pattern = relative ? extra.replace(/^(\.\/)+/, "") : extra

  return (candidate: string): boolean =>
    matchesGlob({
      pattern,
      path: _toPosix(relative ? path.relative(cfg.configDir, candidate) : candidate, path.sep)
    })
}

const _resolveCacheIncludeFiles = (
  cfg: ResolvedKonfigConfig,
  fs: FileSystem,
  path: Path
): Effect.Effect<string[], PlatformError, FileSystem | Path> =>
  Effect.gen(function*() {
    const files: string[] = []
    const skipDirs = _outputDirs(cfg, path)

    for (const extra of cfg.config.cacheInclude ?? []) {
      const abs = path.isAbsolute(extra) ? extra : path.join(cfg.configDir, extra)

      if (_GLOB_CHARS.test(extra)) {
        const candidates = yield* _collectFiles({ dir: _globBase(abs, path.sep), skipDirs })
        files.push(...candidates.filter(_globMatcher(extra, cfg, path)))
      } else {
        const stat = yield* _orAbsentIfNotFound(fs.stat(abs), () => null)

        if (stat?.type === "Directory") {
          files.push(...(yield* _collectFiles({ dir: abs, skipDirs })))
        } else if (stat?.type === "File") {
          files.push(abs)
        }
      }
    }

    return files
  })

const _hashFiles = (
  hash: crypto.Hash,
  fs: FileSystem,
  files: ReadonlyArray<string>
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*() {
    for (const f of [...files].sort()) {
      // Raw bytes, not readFileString: a lossy UTF-8 decode could map distinct
      // binary contents to the same string, causing a false cache hit.
      const content = yield* _orAbsentIfNotFound(fs.readFile(f), () => new Uint8Array())
      hash.update(`file:${f}\n`)
      hash.update(content)
      hash.update("\n")
    }
  })

// Hash is conservative: touching any file under the env root invalidates the
// cache. False negatives only, never a false positive.
export const computeInputHash = (input: ComputeInputHashInput) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const { cfg, envName, ctx } = input

    const hash = crypto.createHash("sha256")
    hash.update(yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(cfg.config))
    hash.update("\n")
    hash.update(`ctx:${_ctxSignature(ctx)}\n`)

    yield* _hashEntry(hash, fs, envEntryPath({ cfg, envName, pathJoin: path.join }))

    const rootAbs = path.join(cfg.configDir, cfg.config.root)
    const files = yield* _collectFiles({ dir: rootAbs, skipDirs: _outputDirs(cfg, path) })
    files.push(...(yield* _resolveCacheIncludeFiles(cfg, fs, path)))
    files.push(...(yield* _findLockfiles(cfg.configDir)))

    yield* _hashFiles(hash, fs, files)

    return hash.digest("hex")
  })

const _GLOB_CHARS = /[*?[{]/

const _globBase = (pattern: string, sep: string): string => {
  const staticSegs: string[] = []

  for (const seg of pattern.split(sep)) {
    if (_GLOB_CHARS.test(seg)) break
    staticSegs.push(seg)
  }

  return staticSegs.join(sep) || sep
}

const _ALWAYS_SKIPPED_DIRS: ReadonlySet<string> = new Set(["node_modules", "dist", ".konfig", ".git"])

interface CollectFilesInput {
  readonly dir: string
  readonly skipDirs: ReadonlySet<string>
}

const _collectFiles = (input: CollectFilesInput) =>
  walkFiles({
    dir: input.dir,
    skipDir: ({ full, name }) => _ALWAYS_SKIPPED_DIRS.has(name) || input.skipDirs.has(full)
  })

const _outputDirs = (cfg: ResolvedKonfigConfig, path: Path): ReadonlySet<string> =>
  new Set([
    path.join(cfg.configDir, cfg.config.root, cfg.config.outDir.manifests),
    path.resolve(cfg.configDir, cfg.config.helm?.cacheDir ?? DEFAULT_HELM_CACHE_DIR)
  ])

const _LOCKFILES = ["bun.lock", "bun.lockb", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"] as const

// Walks up from the config dir to the nearest directory holding a lockfile:
// node_modules is never hashed, so dependency upgrades only show up here.
const _findLockfiles = (
  dir: string
): Effect.Effect<ReadonlyArray<string>, never, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path

    const present = yield* Effect.filter(
      _LOCKFILES.map((name) => path.join(dir, name)),
      (candidate) => fs.exists(candidate).pipe(Effect.orElseSucceed(() => false))
    )

    if (present.length > 0) return present
    const parent = path.dirname(dir)

    return parent === dir ? [] : yield* _findLockfiles(parent)
  })

export const computeOutputHash = (
  files: ReadonlyArray<{ readonly path: string; readonly content: string }>
): string => {
  const hash = crypto.createHash("sha256")
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  for (const f of sorted) {
    hash.update(`${f.path}\n`)
    hash.update(f.content)
    hash.update("\n")
  }

  return hash.digest("hex")
}

export const computeOnDiskOutputHash = (
  outDirAbs: string
): Effect.Effect<string, never, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const paths = yield* walkFiles({ dir: outDirAbs })

    const files = yield* Effect.forEach(paths, (path) =>
      fs.readFileString(path).pipe(
        Effect.orElseSucceed(() => ""),
        Effect.map((content) => ({ path, content }))
      ))

    return computeOutputHash(files)
  })

// Folds a digest of the render-context signature into the filename so builds
// for the same env but different cluster/k8sVersion/flags don't share a slot.
const _cacheFilePath = (
  cfg: ResolvedKonfigConfig,
  envName: string,
  ctx: RenderContext,
  joinFn: (...parts: string[]) => string
): string => {
  const ctxKey = crypto.createHash("sha256").update(_ctxSignature(ctx)).digest("hex").slice(0, 16)

  return joinFn(cfg.configDir, ".konfig", "cache", `${envName}-${ctxKey}.json`)
}

interface ReadEntryInput {
  readonly cfg: ResolvedKonfigConfig
  readonly envName: string
  readonly ctx: RenderContext
}

export const readCacheEntry = (input: ReadEntryInput) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const cacheFile = _cacheFilePath(input.cfg, input.envName, input.ctx, path.join)
    const exists = yield* fs.exists(cacheFile).pipe(Effect.orElseSucceed(() => false))

    if (!exists) return undefined
    const text = yield* fs.readFileString(cacheFile).pipe(Effect.orElseSucceed(() => ""))

    if (text === "") return undefined

    // A decode failure (stale/corrupt cache file) is just a cache miss.
    return yield* _decodeCacheEntryJson(text).pipe(
      Effect.orElseSucceed((): BuildCacheEntry | undefined => undefined)
    )
  })

interface WriteEntryInput {
  readonly cfg: ResolvedKonfigConfig
  readonly envName: string
  readonly ctx: RenderContext
  readonly entry: BuildCacheEntry
}

const _formatCacheEntry = (entry: BuildCacheEntry): string => `${JSON.stringify(entry, null, 2)}\n`

export const writeCacheEntry = (input: WriteEntryInput) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const cacheFile = _cacheFilePath(input.cfg, input.envName, input.ctx, path.join)
    const dir = path.dirname(cacheFile)
    yield* fs
      .makeDirectory(dir, { recursive: true })
      .pipe(Effect.mapError((cause) => new BuildCacheError({ path: dir, cause })))
    yield* fs
      .writeFileString(cacheFile, _formatCacheEntry(input.entry))
      .pipe(Effect.mapError((cause) => new BuildCacheError({ path: cacheFile, cause })))
  })
