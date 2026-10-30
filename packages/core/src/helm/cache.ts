import { type Config, type Deferred, Effect, Option, Stream } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import type { PlatformError } from "effect/PlatformError"
import { ChildProcess } from "effect/process"
import type { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { createHash } from "node:crypto"
import { HelmDigestMismatch, HelmRenderError } from "../RenderError"
import { singleFlight } from "../singleFlight"
import { type ProcessFailure, runProcessExit } from "../subprocess"
import { timeout } from "./timeout"

export interface CacheFileNameInput {
  readonly chart: string
  readonly version: string
  // Omit when the chart registry entry has no recorded digest yet — the
  // filename falls back to the plain `<chart>-<version>.tgz` form. This is
  // the single naming rule shared by `Helm.release`'s own cache, `konfig
  // helm fetch`, and `konfig crd extract`, so a `helm fetch --all` actually
  // warms the cache `Helm.release` reads from during a render.
  readonly digest?: string
}

// Truncated to 12 hex chars: long enough to make an accidental collision
// between two chart versions astronomically unlikely, short enough to keep
// cache filenames readable.
export const cacheFileName = (input: CacheFileNameInput): string => {
  if (input.digest === undefined) return `${input.chart}-${input.version}.tgz`
  const digestSuffix = _normalizeDigest(input.digest).slice("sha256:".length, "sha256:".length + 12)

  return `${input.chart}-${input.version}-${digestSuffix}.tgz`
}

export const _normalizeDigest = (digest: string): string => {
  const lower = digest.trim().toLowerCase()

  return lower.startsWith("sha256:") ? lower : `sha256:${lower}`
}

// Streamed through node:crypto rather than readFile + crypto.subtle so a
// large chart tarball never has to sit in memory whole.
const _hashFile = (filePath: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const hash = createHash("sha256")
    yield* Stream.runForEach(fs.stream(filePath), (chunk) => Effect.sync(() => hash.update(chunk)))

    return `sha256:${hash.digest("hex")}`
  })

const _logCleanupFailure = (error: PlatformError) => Effect.logDebug(`helm: cleanup failed: ${error.message}`)

interface _VerifiedDigest {
  readonly mtimeMs: number
  readonly size: bigint
  readonly digest: string
}

const _verifiedDigests = new WeakMap<FileSystem, Map<string, _VerifiedDigest>>()

const _digestsFor = (fs: FileSystem): Map<string, _VerifiedDigest> => {
  const existing = _verifiedDigests.get(fs)

  if (existing !== undefined) return existing
  const fresh = new Map<string, _VerifiedDigest>()
  _verifiedDigests.set(fs, fresh)

  return fresh
}

const _hashFileCached = (filePath: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const info = yield* fs.stat(filePath)
    const mtimeMs = Option.map(info.mtime, (d) => d.getTime())

    if (Option.isNone(mtimeMs)) return yield* _hashFile(filePath)
    const hit = _digestsFor(fs).get(filePath)

    if (hit !== undefined && hit.mtimeMs === mtimeMs.value && hit.size === info.size) return hit.digest
    const digest = yield* _hashFile(filePath)
    _digestsFor(fs).set(filePath, { mtimeMs: mtimeMs.value, size: info.size, digest })

    return digest
  })

export interface VerifyChartDigestInput {
  readonly chart: string
  readonly version: string
  readonly digest: string
  readonly cachedTgz: string
}

// Shared by `Helm.release`'s own cache (verified on every hit, not just
// after a fresh pull) and by CLI callers (`konfig helm fetch`, `konfig crd
// extract`) that want the same guarantee before they hand a tarball off to
// `helm template`.
export const verifyChartDigest = (input: VerifyChartDigestInput) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const expected = _normalizeDigest(input.digest)
    const actual = yield* _hashFileCached(input.cachedTgz)

    if (expected !== actual) {
      _digestsFor(fs).delete(input.cachedTgz)
      yield* fs.remove(input.cachedTgz).pipe(Effect.catch(_logCleanupFailure))

      return yield* new HelmDigestMismatch({
        chart: input.chart,
        version: input.version,
        expected,
        actual
      })
    }
  })

export interface EnsureChartTarballInput {
  readonly repo: string
  readonly chart: string
  readonly version: string
  readonly cacheDir: string
  // Omit when the chart registry entry has no recorded digest: the tarball is
  // then cached under the plain name and not verified.
  readonly digest?: string
}

export interface PullArgsInput {
  readonly repo: string
  readonly chart: string
  readonly version: string
  readonly destination: string
}

const _OCI_PREFIX = "oci://"

// Callers must pass schema-validated chart fields; this builder does no validation.
export const pullArgs = (input: PullArgsInput): ReadonlyArray<string> => [
  "pull",
  ...(input.repo.startsWith(_OCI_PREFIX) ? [`${input.repo}/${input.chart}`] : ["--repo", input.repo, input.chart]),
  "--version",
  input.version,
  "--destination",
  input.destination
]

interface _SlotInput extends EnsureChartTarballInput {
  readonly cachedTgz: string
}

type _PullError = HelmRenderError | HelmDigestMismatch | ProcessFailure | Config.ConfigError | PlatformError

type _PullOnce = Effect.Effect<void, _PullError, FileSystem | Path | ChildProcessSpawner>

// In-flight pulls keyed by cached tarball path. Renders run several releases
// concurrently, and two releases of the same chart@version would otherwise
// both miss the cache and both spawn `helm pull`; the second now awaits the
// first's result. Entries are dropped once the pull settles so a failed pull
// is retried by the next render rather than replayed from memory.
const _pullsInFlight = new Map<string, Deferred.Deferred<void, _PullError>>()

const _pullOnce = (input: { readonly cachedTgz: string; readonly pull: _PullOnce }): _PullOnce =>
  singleFlight({ store: _pullsInFlight, key: input.cachedTgz, run: input.pull, keepOnSuccess: false })

const _verifyPinned = (input: _SlotInput) =>
  input.digest === undefined
    ? Effect.void
    : verifyChartDigest({
      chart: input.chart,
      version: input.version,
      digest: input.digest,
      cachedTgz: input.cachedTgz
    })

const _singleTarball = (input: _SlotInput & { readonly pullDir: string; readonly files: ReadonlyArray<string> }) => {
  const candidates = input.files.filter((f) => f.endsWith(".tgz") && f.startsWith(input.chart))
  const [pulled] = candidates

  return candidates.length === 1 && pulled !== undefined
    ? Effect.succeed(pulled)
    : Effect.fail(
      new HelmRenderError({
        chart: input.chart,
        version: input.version,
        phase: "pull",
        cause: `helm pull produced ${candidates.length} matching tarball(s) in ${input.pullDir}, expected exactly 1`
      })
    )
}

const _pullIntoTemp = (input: { readonly slot: _SlotInput; readonly pullDir: string }) =>
  Effect.gen(function*() {
    const { pullDir, slot } = input
    const fs = yield* FileSystem
    const path = yield* Path
    yield* runProcessExit({
      command: ChildProcess.make("helm", pullArgs({ ...slot, destination: pullDir })),
      options: { timeout: yield* timeout }
    })
    const files = yield* fs.readDirectory(pullDir)
    const pulled = yield* _singleTarball({ ...slot, pullDir, files })
    yield* fs.rename(path.join(pullDir, pulled), slot.cachedTgz)
    yield* _verifyPinned(slot)
  })

// Pulled into a per-invocation temp directory nested inside cacheDir (same
// filesystem, so the rename is atomic) rather than diffing directory listings,
// which misattributed tarballs when concurrent pulls shared one cache.
const _pullAndVerify = (input: _SlotInput): _PullOnce =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const pullDir = yield* fs.makeTempDirectory({ directory: input.cacheDir, prefix: ".konfig-helm-pull-" })
    yield* Effect.logInfo(`helm: pulling ${input.chart}@${input.version} from ${input.repo}`)
    yield* _pullIntoTemp({ slot: input, pullDir }).pipe(
      Effect.ensuring(fs.remove(pullDir, { recursive: true, force: true }).pipe(Effect.catch(_logCleanupFailure)))
    )
  })

export const ensureChartTarball = (input: EnsureChartTarballInput) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    yield* fs.makeDirectory(input.cacheDir, { recursive: true })
    const cachedTgz = path.join(input.cacheDir, cacheFileName(input))
    const slot = { ...input, cachedTgz }

    if (yield* fs.exists(cachedTgz)) yield* _verifyPinned(slot)
    else yield* _pullOnce({ cachedTgz, pull: _pullAndVerify(slot) })

    return cachedTgz
  })
