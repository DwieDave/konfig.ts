import type { RenderContext, ResolvedKonfigConfig } from "@konfig.ts/core"
import { unsafeCoerce } from "@konfig.ts/core"
import { Data, Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import * as crypto from "node:crypto"

export class BuildCacheError extends Data.TaggedError("BuildCacheError")<{
  readonly path: string
  readonly cause: unknown
}> {}

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

/**
 * Canonical, deterministic serialization of the render-context knobs
 * that change output: the target cluster, the target k8s version, and
 * the free-form flags (sorted by key so map insertion order is
 * irrelevant). Two contexts render-equivalent iff their signatures match.
 */
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

/**
 * Compute a SHA-256 over the inputs that could feed an env's render:
 *  - The env's entry file content (resolved per `cfg.config.envs[env]`
 *    or `<root>/env/<env>.ts`).
 *  - Every file under `cfg.config.root` regardless of extension —
 *    scripts, templates, and data files can all feed a render — (sorted
 *    by path so the hash is deterministic across runs; node_modules,
 *    dist, and .konfig are skipped).
 *  - The konfig.json contents (via `cfg.config` serialized).
 *  - The render context (cluster, k8sVersion, sorted flags) — these
 *    thread into every `renderManifest` call and change the output, so
 *    a build with a different `--k8s-version` / `--cluster` / `--flag`
 *    must be a cache miss.
 *
 * The hash is conservative — touching any file under the env root
 * invalidates the cache. False negatives only; never a false positive.
 */
export const computeInputHash = (input: ComputeInputHashInput) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const { cfg, envName, ctx } = input

    const hash = crypto.createHash("sha256")
    hash.update(JSON.stringify(cfg.config))
    hash.update("\n")
    hash.update(`ctx:${_ctxSignature(ctx)}\n`)

    const envSpec = cfg.config.envs[envName]
    const entry = envSpec === undefined
      ? path.join(cfg.configDir, cfg.config.root, "env", `${envName}.ts`)
      : path.join(cfg.configDir, cfg.config.root, envSpec.entry)
    const entryExists = yield* fs.exists(entry).pipe(Effect.orElseSucceed(() => false))
    if (entryExists) {
      const content = yield* fs.readFileString(entry).pipe(Effect.orElseSucceed(() => ""))
      hash.update(`entry:${entry}\n`)
      hash.update(content)
      hash.update("\n")
    }

    const rootAbs = path.join(cfg.configDir, cfg.config.root)
    const files: string[] = []
    yield* _collectFiles(rootAbs, files)
    files.sort()
    for (const f of files) {
      // Raw bytes, not readFileString: lossy UTF-8 decode would map distinct
      // binary contents to the same string and yield a false cache hit.
      const content = yield* fs.readFile(f).pipe(Effect.orElseSucceed(() => new Uint8Array()))
      hash.update(`file:${f}\n`)
      hash.update(content)
      hash.update("\n")
    }

    return hash.digest("hex")
  })

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

/**
 * Hash a list of (path, content) pairs deterministically. Used to
 * fingerprint the rendered output so the next build can detect
 * out-of-band tampering with the output tree.
 */
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

/**
 * Recompute {@link computeOutputHash} over the tree currently on disk at
 * `outDirAbs`, walking recursively and using each file's absolute path
 * (matching how the entry's `outputHash` was recorded from
 * `rendered.files`). Lets a cache hit detect out-of-band edits/deletes
 * to the rendered tree before honoring it.
 */
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

/**
 * Cache file key. Folds a short digest of the render-context signature
 * into the filename so builds for the same env but different
 * cluster/k8sVersion/flags never share a cache slot.
 */
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
    try {
      const parsed = JSON.parse(text)
      return unsafeCoerce<BuildCacheEntry>(
        parsed,
        "parsed JSON shape matches BuildCacheEntry — caller revalidates by recomputing inputHash"
      )
    } catch {
      return undefined
    }
  })

interface WriteEntryInput {
  readonly cfg: ResolvedKonfigConfig
  readonly envName: string
  readonly ctx: RenderContext
  readonly entry: BuildCacheEntry
}

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
      .writeFileString(cacheFile, `${JSON.stringify(input.entry, null, 2)}\n`)
      .pipe(Effect.mapError((cause) => new BuildCacheError({ path: cacheFile, cause })))
  })
