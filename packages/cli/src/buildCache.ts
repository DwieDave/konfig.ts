import type { RenderContext, ResolvedKonfigConfig } from "@konfig.ts/core"
import { unsafeCoerce } from "@konfig.ts/core"
import { Data, Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import type { PlatformError } from "effect/PlatformError"
import * as crypto from "node:crypto"

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
    Effect.catchIf(
      (e) => e.reason._tag === "NotFound",
      () => Effect.succeed(onAbsent())
    )
  )

export interface BuildCacheEntry {
  readonly inputHash: string
  readonly outputHash: string
  readonly outDirAbs: string
  readonly fileCount: number
  readonly timestamp: string
}

interface ComputeInputHashInput {
  readonly cfg: ResolvedKonfigConfig
  readonly envName: string
  readonly ctx: RenderContext
}

const _ctxSignature = (ctx: RenderContext): string => {
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

const _entryPath = (
  cfg: ResolvedKonfigConfig,
  envName: string,
  path: Path
): string => {
  const envSpec = cfg.config.envs[envName]
  return envSpec === undefined
    ? path.join(cfg.configDir, cfg.config.root, "env", `${envName}.ts`)
    : path.join(cfg.configDir, cfg.config.root, envSpec.entry)
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

const _resolveCacheIncludeFiles = (
  cfg: ResolvedKonfigConfig,
  fs: FileSystem,
  path: Path
): Effect.Effect<string[], PlatformError, FileSystem | Path> =>
  Effect.gen(function*() {
    const files: string[] = []
    for (const extra of cfg.config.cacheInclude ?? []) {
      const abs = path.isAbsolute(extra) ? extra : path.join(cfg.configDir, extra)
      if (_GLOB_CHARS.test(extra)) {
        const candidates: string[] = []
        yield* _collectFiles(_globBase(abs, path.sep), candidates)
        const pattern = _globToRegExp(abs, path.sep)
        for (const c of candidates) {
          if (pattern.test(c)) files.push(c)
        }
      } else {
        const stat = yield* _orAbsentIfNotFound(fs.stat(abs), () => null)
        if (stat?.type === "Directory") {
          yield* _collectFiles(abs, files)
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

    yield* _hashEntry(hash, fs, _entryPath(cfg, envName, path))

    const rootAbs = path.join(cfg.configDir, cfg.config.root)
    const files: string[] = []
    yield* _collectFiles(rootAbs, files)
    files.push(...(yield* _resolveCacheIncludeFiles(cfg, fs, path)))

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

const _REGEXP_SPECIAL = /[\\^$.|+(){}]/

const _globToRegExp = (pattern: string, sep: string): RegExp => {
  const sepClass = sep === "\\" ? "\\\\" : sep
  let source = ""
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        source += ".*"
        i++
        if (pattern[i + 1] === sep) i++
      } else {
        source += `[^${sepClass}]*`
      }
    } else if (c === "?") {
      source += `[^${sepClass}]`
    } else if (c === "[") {
      const end = pattern.indexOf("]", i + 1)
      if (end === -1) {
        source += "\\["
      } else {
        source += pattern.slice(i, end + 1)
        i = end
      }
    } else if (c !== undefined && _REGEXP_SPECIAL.test(c)) {
      source += `\\${c}`
    } else {
      source += c
    }
  }
  return new RegExp(`^${source}$`)
}

const _collectFiles = (
  dir: string,
  out: string[]
): Effect.Effect<void, never, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const entries = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed((): string[] => []))
    for (const e of entries) {
      const full = path.join(dir, e)
      const stat = yield* fs.stat(full).pipe(Effect.orElseSucceed(() => null))
      if (stat === null) continue
      if (stat.type === "Directory") {
        if (e === "node_modules" || e === "dist" || e === ".konfig") continue
        yield* _collectFiles(full, out)
      } else if (stat.type === "File") {
        out.push(full)
      }
    }
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
    const files: { path: string; content: string }[] = []
    yield* _collectOutputFiles(outDirAbs, files)
    return computeOutputHash(files)
  })

const _collectOutputFiles = (
  dir: string,
  out: { path: string; content: string }[]
): Effect.Effect<void, never, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const entries = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed((): string[] => []))
    for (const e of entries) {
      const full = path.join(dir, e)
      const stat = yield* fs.stat(full).pipe(Effect.orElseSucceed(() => null))
      if (stat === null) continue
      if (stat.type === "Directory") {
        yield* _collectOutputFiles(full, out)
      } else if (stat.type === "File") {
        const content = yield* fs.readFileString(full).pipe(Effect.orElseSucceed(() => ""))
        out.push({ path: full, content })
      }
    }
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

const _parseCacheEntry = (text: string): BuildCacheEntry =>
  // oxlint-disable-next-line app/no-parse-coercion
  unsafeCoerce<BuildCacheEntry>(
    JSON.parse(text),
    "parsed JSON shape matches BuildCacheEntry — caller revalidates by recomputing inputHash"
  )

export const readCacheEntry = (input: ReadEntryInput) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const cacheFile = _cacheFilePath(input.cfg, input.envName, input.ctx, path.join)
    const exists = yield* fs.exists(cacheFile).pipe(Effect.orElseSucceed(() => false))
    if (!exists) return undefined
    const text = yield* fs.readFileString(cacheFile).pipe(Effect.orElseSucceed(() => ""))
    if (text === "") return undefined
    return yield* Effect.try(() => _parseCacheEntry(text)).pipe(Effect.orElseSucceed(() => undefined))
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
