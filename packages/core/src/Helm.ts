import { Config, Duration, Effect, Option, Stream } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import type { PlatformError } from "effect/PlatformError"
import { createHash } from "node:crypto"
import * as YAML from "yaml"
import { ChildProcess, ChildProcessSpawner } from "./_unstable"
import { parseYamlAll } from "./diff"
import { isRecord } from "./guards"
import {
  DEFAULT_HELM_CACHE_DIR,
  DEFAULT_HELM_TIMEOUT_SECONDS,
  DEFAULT_HELM_VERSION_TIMEOUT_SECONDS,
  KONFIG_HELM_CACHE_ENV,
  KONFIG_HELM_TIMEOUT_ENV
} from "./konfigDefaults"
import { make, type Manifest, type ParsedDoc } from "./Manifest"
import { HelmDigestMismatch, HelmRenderError, type HelmRenderPhase, HelmVersionTooLow } from "./RenderError"
import { type ProcessFailure, runProcessExit, runProcessString } from "./subprocess"

const CLUSTER_SCOPED_KINDS: ReadonlySet<string> = new Set([
  "APIService",
  "ClusterRole",
  "ClusterRoleBinding",
  "ComponentStatus",
  "CSIDriver",
  "CSINode",
  "CustomResourceDefinition",
  "FlowSchema",
  "IngressClass",
  "MutatingWebhookConfiguration",
  "Namespace",
  "Node",
  "PersistentVolume",
  "PodSecurityPolicy",
  "PriorityClass",
  "PriorityLevelConfiguration",
  "RuntimeClass",
  "StorageClass",
  "ValidatingAdmissionPolicy",
  "ValidatingAdmissionPolicyBinding",
  "ValidatingWebhookConfiguration",
  "VolumeAttachment"
])

export interface HelmReleaseOptions {
  readonly repo: string
  readonly chart: string
  readonly releaseName?: string
  readonly version: string
  readonly digest: string
  readonly namespace?: string
  readonly values: Record<string, unknown>
  readonly extraOpts?: readonly string[]
  // When set, runs a `helm version --short` preflight and fails HelmVersionTooLow if older.
  readonly minVersion?: string
}

interface _ParseHelmOutputInput {
  readonly output: string
  readonly chart: string
  readonly version: string
  readonly namespace: string | undefined
}
// Uses parseYamlAll (not a naive /^---$/m split) so a `---` inside a block scalar can't
// spuriously split one manifest into two. Docs stay parsed (ParsedDoc, not
// RawYaml): re-stringifying here only for the CLI to parse and serialize again
// roughly doubled the CPU spent per helm doc.
const _parseHelmOutput = (input: _ParseHelmOutputInput): Effect.Effect<ParsedDoc[]> =>
  Effect.sync(() => {
    const { output, chart, version, namespace } = input
    const origin = `helm:${chart}@${version}`
    const results: ParsedDoc[] = []
    for (const parsed of parseYamlAll(output)) {
      let value: unknown = parsed
      if (namespace !== undefined && isRecord(parsed)) {
        const kind = parsed["kind"]
        const metadata = isRecord(parsed["metadata"]) ? parsed["metadata"] : undefined
        const ns = metadata?.["namespace"]
        if (
          typeof kind === "string" &&
          !CLUSTER_SCOPED_KINDS.has(kind) &&
          (ns === undefined || ns === "")
        ) {
          value = { ...parsed, metadata: { ...metadata, namespace } }
        }
      }
      results.push({ _tag: "ParsedDoc", value, origin })
    }
    return results
  })

const _HELM_VERSION_RE = /v?(\d+)\.(\d+)\.(\d+)/

const _parseVersionTriple = (text: string): readonly [number, number, number] | null => {
  const m = _HELM_VERSION_RE.exec(text.trim())
  if (m === null) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

const _isBelow = (
  found: readonly [number, number, number],
  min: readonly [number, number, number]
): boolean => {
  for (let i = 0; i < 3; i++) {
    const f = found[i] ?? 0
    const m = min[i] ?? 0
    if (f < m) return true
    if (f > m) return false
  }
  return false
}

// How long a network-bound helm call (`pull`, `template`) may run before konfig
// gives up with ProcessTimeout. Without a bound, a `helm pull` that prompts for
// registry credentials sits forever on a closed stdin. KONFIG_HELM_TIMEOUT takes
// a bare number of seconds ("300") or an effect duration ("5 minutes").
export const timeout: Config.Config<Duration.Duration> = Config.Number(KONFIG_HELM_TIMEOUT_ENV).pipe(
  Config.map(Duration.seconds),
  Config.orElse(() => Config.Duration(KONFIG_HELM_TIMEOUT_ENV)),
  Config.withDefault(Duration.seconds(DEFAULT_HELM_TIMEOUT_SECONDS))
)

// The `helm version` preflight is local; capped at the smaller of 30s and the configured timeout.
export const versionTimeout: Config.Config<Duration.Duration> = Config.map(
  timeout,
  (t) => Duration.min(t, Duration.seconds(DEFAULT_HELM_VERSION_TIMEOUT_SECONDS))
)

type _HelmVersionProbe = Effect.Effect<string, ProcessFailure | Config.ConfigError, ChildProcessSpawner>

const _helmVersionProbe: _HelmVersionProbe = Effect.gen(function*() {
  const cmd = ChildProcess.make("helm", ["version", "--short"])
  return yield* versionTimeout.pipe(
    Effect.flatMap((t) => runProcessString(cmd, { allowEmptyStdout: false, timeout: t }))
  )
})

// `helm version --short` is spawned once per process, not once per release:
// the binary doesn't change under a running render. Keyed by the spawner
// service (not truly module-global) so a test that swaps in a different mock
// spawner per case isn't served the previous case's answer. `Effect.cached` is
// a pure `sync` constructor, so building it under `runSync` inside the map
// check is race-free; concurrent first callers share the one in-flight probe.
const _helmVersionBySpawner = new WeakMap<ChildProcessSpawner["Service"], _HelmVersionProbe>()

const _memoizedHelmVersion: _HelmVersionProbe = Effect.gen(function*() {
  const spawner = yield* ChildProcessSpawner
  let probe = _helmVersionBySpawner.get(spawner)
  if (probe === undefined) {
    // oxlint-disable-next-line effecttsgo/run-effect-inside-effect -- must not yield between the map check and set
    probe = Effect.runSync(Effect.cached(_helmVersionProbe))
    _helmVersionBySpawner.set(spawner, probe)
  }
  return yield* probe
})

// A failed `helm version` (not on PATH, permission denied, timeout) surfaces as
// its ProcessError/ProcessTimeout; HelmVersionTooLow is reserved for a version
// that was actually read and is too old (or unparseable).
const _assertHelmMinVersion = (
  minVersion: string
): Effect.Effect<void, HelmVersionTooLow | ProcessFailure | Config.ConfigError, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const stdout = yield* _memoizedHelmVersion
    const found = _parseVersionTriple(stdout)
    const min = _parseVersionTriple(minVersion)
    if (found === null || (min !== null && _isBelow(found, min))) {
      return yield* new HelmVersionTooLow({ required: minVersion, found: stdout.trim() })
    }
  })

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
  const digestSuffix = input.digest.replace(/^sha256:/, "").slice(0, 12)
  return `${input.chart}-${input.version}-${digestSuffix}.tgz`
}

const _normalizeDigest = (digest: string): string => digest.startsWith("sha256:") ? digest : `sha256:${digest}`

// Streamed through node:crypto rather than readFile + crypto.subtle so a
// large chart tarball never has to sit in memory whole.
const _hashFile = (filePath: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const hash = createHash("sha256")
    yield* Stream.runForEach(fs.stream(filePath), (chunk) => Effect.sync(() => hash.update(chunk)))
    return `sha256:${hash.digest("hex")}`
  })

interface _VerifiedDigest {
  readonly mtimeMs: number
  readonly size: bigint
  readonly digest: string
}

// Digests already computed in this process, keyed by tarball path and
// invalidated by (mtime, size). A render of N releases against a warm cache
// hashes each distinct chart once instead of once per release.
const _verifiedDigests = new Map<string, _VerifiedDigest>()

const _hashFileCached = (filePath: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const info = yield* fs.stat(filePath)
    const mtimeMs = Option.map(info.mtime, (d) => d.getTime())
    if (Option.isNone(mtimeMs)) return yield* _hashFile(filePath)
    const hit = _verifiedDigests.get(filePath)
    if (hit !== undefined && hit.mtimeMs === mtimeMs.value && hit.size === info.size) return hit.digest
    const digest = yield* _hashFile(filePath)
    _verifiedDigests.set(filePath, { mtimeMs: mtimeMs.value, size: info.size, digest })
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
      _verifiedDigests.delete(input.cachedTgz)
      yield* fs.remove(input.cachedTgz).pipe(Effect.ignore)
      return yield* new HelmDigestMismatch({
        chart: input.chart,
        version: input.version,
        expected,
        actual
      })
    }
  })

interface _EnsureCachedTarballInput {
  readonly opts: HelmReleaseOptions
  readonly cacheDir: string
  readonly cachedTgz: string
}
type _PullOnce = Effect.Effect<
  void,
  HelmRenderError | HelmDigestMismatch | ProcessFailure | Config.ConfigError | PlatformError,
  FileSystem | Path | ChildProcessSpawner
>

// In-flight pulls keyed by cached tarball path. Renders run several releases
// concurrently, and two releases of the same chart@version would otherwise
// both miss the cache and both spawn `helm pull`; the second now awaits the
// first's result. Entries are dropped once the pull settles so a failed pull
// is retried by the next render rather than replayed from memory.
const _pullsInFlight = new Map<string, _PullOnce>()

const _pullOnce = (cachedTgz: string, pull: _PullOnce): _PullOnce =>
  Effect.suspend(() => {
    const inFlight = _pullsInFlight.get(cachedTgz)
    if (inFlight !== undefined) return inFlight
    // oxlint-disable-next-line effecttsgo/run-effect-inside-effect -- must not yield between the map check and set
    const shared = Effect.runSync(Effect.cached(pull)).pipe(
      Effect.ensuring(Effect.sync(() => _pullsInFlight.delete(cachedTgz)))
    )
    _pullsInFlight.set(cachedTgz, shared)
    return shared
  })

const _ensureCachedTarball = (input: _EnsureCachedTarballInput) =>
  Effect.gen(function*() {
    const { opts, cachedTgz } = input
    const fs = yield* FileSystem

    const cacheExists = yield* fs.exists(cachedTgz)
    if (cacheExists) {
      yield* verifyChartDigest({ chart: opts.chart, version: opts.version, digest: opts.digest, cachedTgz })
      return
    }

    yield* _pullOnce(cachedTgz, _pullAndVerify(input))
  })

const _pullAndVerify = (input: _EnsureCachedTarballInput): _PullOnce =>
  Effect.gen(function*() {
    const { opts, cacheDir, cachedTgz } = input
    const fs = yield* FileSystem
    const path = yield* Path

    // Pull into a per-invocation temp directory nested inside cacheDir (same
    // filesystem, so the rename below is atomic), then rename the known
    // output into place. This replaces diffing directory listings
    // before/after `helm pull`, which misattributed tarballs when concurrent
    // releases shared KONFIG_HELM_CACHE.
    const pullDir = yield* fs.makeTempDirectory({ directory: cacheDir, prefix: ".konfig-helm-pull-" })

    yield* Effect.logInfo(`helm: pulling ${opts.chart}@${opts.version} from ${opts.repo}`)
    yield* Effect.gen(function*() {
      const pull = ChildProcess.make("helm", [
        "pull",
        "--repo",
        opts.repo,
        opts.chart,
        "--version",
        opts.version,
        "--destination",
        pullDir
      ])
      yield* runProcessExit(pull, { timeout: yield* timeout })

      const pulledFiles = yield* fs.readDirectory(pullDir)
      const candidates = pulledFiles.filter((f) => f.endsWith(".tgz") && f.startsWith(opts.chart))
      const pulled = candidates[0]
      if (candidates.length !== 1 || pulled === undefined) {
        return yield* new HelmRenderError({
          chart: opts.chart,
          version: opts.version,
          phase: "pull",
          cause: `helm pull produced ${candidates.length} matching tarball(s) in ${pullDir}, expected exactly 1`
        })
      }

      // `fs.rename` performs an atomic replace on POSIX, so a second
      // concurrent release racing to populate the same cache entry
      // overwrites harmlessly with byte-identical content (helm pull for a
      // pinned version is deterministic) rather than corrupting the cache.
      yield* fs.rename(path.join(pullDir, pulled), cachedTgz)
    }).pipe(
      Effect.ensuring(fs.remove(pullDir, { recursive: true, force: true }).pipe(Effect.ignore))
    )

    yield* verifyChartDigest({ chart: opts.chart, version: opts.version, digest: opts.digest, cachedTgz })
  })

type _ReleaseError = HelmRenderError | HelmVersionTooLow | HelmDigestMismatch

// HelmVersionTooLow and HelmDigestMismatch already name the chart and carry a
// precise message, so they pass through; everything else is wrapped with the
// phase it failed in.
const _inPhase =
  (opts: HelmReleaseOptions, phase: HelmRenderPhase) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, _ReleaseError, R> =>
    Effect.mapError(
      self,
      (cause): _ReleaseError =>
        cause instanceof HelmVersionTooLow || cause instanceof HelmDigestMismatch || cause instanceof HelmRenderError
          ? cause
          : new HelmRenderError({ chart: opts.chart, version: opts.version, phase, cause })
    )

export const release = (opts: HelmReleaseOptions): Manifest<ParsedDoc[]> => {
  const extraOpts = opts.extraOpts ?? []

  return make<ParsedDoc[]>(() =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path

      if (opts.minVersion !== undefined) {
        yield* _assertHelmMinVersion(opts.minVersion).pipe(_inPhase(opts, "version-check"))
      }

      // cacheDir is read from Config (KONFIG_HELM_CACHE) rather than accepted
      // as a HelmReleaseOptions field: the CLI's build/validate/diff
      // commands install a ConfigProvider around the whole render — env var
      // > konfig.json's `helm.cacheDir` > this default, resolved once in
      // cliConfig.ts#resolveCliPaths — so every Helm.release() call across a
      // project's chart definitions shares one resolved cache directory
      // without threading it through every call site. `minVersion` stays a
      // plain, opt-in HelmReleaseOptions field instead of following the same
      // Config indirection: it's a per-chart floor a chart author chooses,
      // not a shared filesystem path, and the project-wide default the CLI
      // resolves the same way is enforced at the CLI boundary instead (the
      // `helm version` preflight in `crd extract`/`crd verify`/`helm fetch`).
      const cacheDir = yield* Config.String(KONFIG_HELM_CACHE_ENV).pipe(
        Config.withDefault(path.resolve(DEFAULT_HELM_CACHE_DIR)),
        _inPhase(opts, "pull")
      )
      yield* fs.makeDirectory(cacheDir, { recursive: true }).pipe(_inPhase(opts, "pull"))

      const cachedTgz = path.join(
        cacheDir,
        cacheFileName({ chart: opts.chart, version: opts.version, digest: opts.digest })
      )
      yield* _ensureCachedTarball({ opts, cacheDir, cachedTgz }).pipe(_inPhase(opts, "pull"))

      const tmpDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-helm-" }).pipe(_inPhase(opts, "template"))
      const valuesFile = path.join(tmpDir, "values.yaml")
      yield* fs.writeFileString(valuesFile, YAML.stringify(opts.values, { lineWidth: 0 })).pipe(
        _inPhase(opts, "template")
      )

      const releaseName = opts.releaseName ?? opts.chart
      const template = ChildProcess.make("helm", [
        "template",
        releaseName,
        cachedTgz,
        "--values",
        valuesFile,
        ...(opts.namespace !== undefined ? ["--namespace", opts.namespace] : []),
        ...extraOpts
      ])
      yield* Effect.logDebug(`helm: templating ${opts.chart}@${opts.version} as release ${releaseName}`)
      const stdout = yield* timeout.pipe(
        Effect.flatMap((t) => runProcessString(template, { allowEmptyStdout: false, timeout: t })),
        _inPhase(opts, "template")
      )
      return yield* _parseHelmOutput({
        output: stdout,
        chart: opts.chart,
        version: opts.version,
        namespace: opts.namespace
      }).pipe(_inPhase(opts, "parse"))
    }).pipe(Effect.scoped)
  )
}
