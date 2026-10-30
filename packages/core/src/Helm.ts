import { Cause, Config, Deferred, Duration, Effect, Exit, Option, Stream } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import type { PlatformError } from "effect/PlatformError"
import { ChildProcess } from "effect/process"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { createHash } from "node:crypto"
import * as YAML from "yaml"
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
import {
  HelmDigestMismatch,
  HelmMinVersionInvalid,
  HelmRenderError,
  type HelmRenderPhase,
  HelmVersionTooLow
} from "./RenderError"
import { compareSemver, parseSemver } from "./semver"
import { type ProcessFailure, runProcessExit, runProcessString } from "./subprocess"

const CLUSTER_SCOPED_KINDS: ReadonlySet<string> = new Set([
  "APIService",
  "CertificateSigningRequest",
  "ClusterRole",
  "ClusterRoleBinding",
  "ClusterTrustBundle",
  "ComponentStatus",
  "CSIDriver",
  "CSINode",
  "CustomResourceDefinition",
  "DeviceClass",
  "FlowSchema",
  "IngressClass",
  "IPAddress",
  "MutatingAdmissionPolicy",
  "MutatingAdmissionPolicyBinding",
  "MutatingWebhookConfiguration",
  "Namespace",
  "Node",
  "PersistentVolume",
  "PodSecurityPolicy",
  "PriorityClass",
  "PriorityLevelConfiguration",
  "ResourceSlice",
  "RuntimeClass",
  "SelfSubjectAccessReview",
  "SelfSubjectReview",
  "SelfSubjectRulesReview",
  "ServiceCIDR",
  "StorageClass",
  "StorageVersion",
  "StorageVersionMigration",
  "SubjectAccessReview",
  "TokenReview",
  "ValidatingAdmissionPolicy",
  "ValidatingAdmissionPolicyBinding",
  "ValidatingWebhookConfiguration",
  "VolumeAttachment",
  "VolumeAttributesClass"
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
  // Custom-resource kinds to treat as cluster-scoped when their CRD is not part of the chart output.
  readonly clusterScopedKinds?: ReadonlyArray<string>
}

interface _ParseHelmOutputInput {
  readonly output: string
  readonly chart: string
  readonly version: string
  readonly namespace: string | undefined
  readonly clusterScopedKinds?: ReadonlyArray<string>
}

const _crdClusterKind = (doc: unknown): ReadonlyArray<string> => {
  if (!isRecord(doc) || doc["kind"] !== "CustomResourceDefinition" || !isRecord(doc["spec"])) return []
  const kind = isRecord(doc["spec"]["names"]) ? doc["spec"]["names"]["kind"] : undefined
  return doc["spec"]["scope"] === "Cluster" && typeof kind === "string" ? [kind] : []
}

interface _ScopedKindsInput {
  readonly docs: ReadonlyArray<unknown>
  readonly extra: ReadonlyArray<string>
}
const _scopedKinds = ({ docs, extra }: _ScopedKindsInput): ReadonlySet<string> =>
  new Set([...CLUSTER_SCOPED_KINDS, ...extra, ...docs.flatMap(_crdClusterKind)])

interface _StampInput {
  readonly doc: unknown
  readonly namespace: string
  readonly clusterKinds: ReadonlySet<string>
}
const _stampNamespace = ({ doc, namespace, clusterKinds }: _StampInput): unknown => {
  if (!isRecord(doc)) return doc
  const kind = doc["kind"]
  const metadata = isRecord(doc["metadata"]) ? doc["metadata"] : undefined
  const ns = metadata?.["namespace"]
  const needsNamespace = typeof kind === "string" && !clusterKinds.has(kind) && (ns === undefined || ns === "")
  return needsNamespace ? { ...doc, metadata: { ...metadata, namespace } } : doc
}

// Uses parseYamlAll (not a naive /^---$/m split) so a `---` inside a block scalar can't
// spuriously split one manifest into two. Docs stay parsed (ParsedDoc, not
// RawYaml): re-stringifying here only for the CLI to parse and serialize again
// roughly doubled the CPU spent per helm doc.
const _parseHelmOutput = (input: _ParseHelmOutputInput): Effect.Effect<ParsedDoc[]> =>
  Effect.sync(() => {
    const { output, chart, version, namespace } = input
    const origin = `helm:${chart}@${version}`
    const docs = parseYamlAll(output)
    const clusterKinds = _scopedKinds({ docs, extra: input.clusterScopedKinds ?? [] })
    return docs.map((doc): ParsedDoc => ({
      _tag: "ParsedDoc",
      value: namespace === undefined ? doc : _stampNamespace({ doc, namespace, clusterKinds }),
      origin
    }))
  })

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
// spawner per case isn't served the previous case's answer. Only a successful
// probe is remembered; a failure (timeout, transient spawn error) is retried by
// the next caller instead of being replayed for the whole process.
interface _VersionSlot {
  value: string | undefined
}
const _helmVersionBySpawner = new WeakMap<ChildProcessSpawner["Service"], _VersionSlot>()

const _slotFor = (spawner: ChildProcessSpawner["Service"]): _VersionSlot => {
  const existing = _helmVersionBySpawner.get(spawner)
  if (existing !== undefined) return existing
  const slot: _VersionSlot = { value: undefined }
  _helmVersionBySpawner.set(spawner, slot)
  return slot
}

const _memoizedHelmVersion: _HelmVersionProbe = Effect.gen(function*() {
  const slot = _slotFor(yield* ChildProcessSpawner)
  if (slot.value !== undefined) return slot.value
  const stdout = yield* _helmVersionProbe
  slot.value = stdout
  return stdout
})

// A failed `helm version` (not on PATH, permission denied, timeout) surfaces as
// its ProcessError/ProcessTimeout; HelmVersionTooLow is reserved for a version
// that was actually read and is too old (or unparseable). A minVersion that is
// not major.minor[.patch] fails before helm is ever spawned.
export const assertMinVersion = (
  minVersion: string
): Effect.Effect<
  void,
  HelmVersionTooLow | HelmMinVersionInvalid | ProcessFailure | Config.ConfigError,
  ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const min = parseSemver(minVersion)
    if (min === null) return yield* new HelmMinVersionInvalid({ minVersion })
    const stdout = yield* _memoizedHelmVersion
    const found = parseSemver(stdout)
    if (found === null || compareSemver({ a: found, b: min }) < 0) {
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

// Callers must pass schema-validated chart fields; this builder does no validation.
export const pullArgs = (input: PullArgsInput): ReadonlyArray<string> => [
  "pull",
  "--repo",
  input.repo,
  input.chart,
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

interface _Claim {
  readonly owner: boolean
  readonly deferred: Deferred.Deferred<void, _PullError>
}

const _claimPull = (input: { readonly key: string; readonly fresh: Deferred.Deferred<void, _PullError> }) =>
  Effect.sync((): _Claim => {
    const existing = _pullsInFlight.get(input.key)
    if (existing !== undefined) return { owner: false, deferred: existing }
    _pullsInFlight.set(input.key, input.fresh)
    return { owner: true, deferred: input.fresh }
  })

const _settlePull =
  (input: { readonly key: string; readonly deferred: Deferred.Deferred<void, _PullError> }) =>
  (exit: Exit.Exit<void, _PullError>) =>
    Effect.sync(() => _pullsInFlight.delete(input.key)).pipe(Effect.andThen(Deferred.done(input.deferred, exit)))

const _ownerInterrupted = (exit: Exit.Exit<void, _PullError>) =>
  Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)

const _awaitOwner = (input: { readonly deferred: Deferred.Deferred<void, _PullError>; readonly retry: _PullOnce }) =>
  Effect.exit(Deferred.await(input.deferred)).pipe(
    Effect.flatMap((exit) => _ownerInterrupted(exit) ? input.retry : exit)
  )

const _pullOnce = (input: { readonly cachedTgz: string; readonly pull: _PullOnce }): _PullOnce =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function*() {
      const fresh = yield* Deferred.make<void, _PullError>()
      const claim = yield* _claimPull({ key: input.cachedTgz, fresh })
      if (!claim.owner) return yield* restore(_awaitOwner({ deferred: claim.deferred, retry: _pullOnce(input) }))
      yield* Effect.onExit(restore(input.pull), _settlePull({ key: input.cachedTgz, deferred: fresh }))
    })
  )

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

const _pullIntoTemp = (input: _SlotInput, pullDir: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    yield* runProcessExit(ChildProcess.make("helm", pullArgs({ ...input, destination: pullDir })), {
      timeout: yield* timeout
    })
    const files = yield* fs.readDirectory(pullDir)
    const pulled = yield* _singleTarball({ ...input, pullDir, files })
    const tempTgz = path.join(pullDir, pulled)
    yield* _verifyPinned({ ...input, cachedTgz: tempTgz })
    // `fs.rename` is an atomic replace on POSIX, so a concurrent release
    // racing to populate the same slot overwrites harmlessly with
    // byte-identical content.
    yield* fs.rename(tempTgz, input.cachedTgz)
  })

// Pulled into a per-invocation temp directory nested inside cacheDir (same
// filesystem, so the rename is atomic) rather than diffing directory listings,
// which misattributed tarballs when concurrent pulls shared one cache.
const _pullAndVerify = (input: _SlotInput): _PullOnce =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const pullDir = yield* fs.makeTempDirectory({ directory: input.cacheDir, prefix: ".konfig-helm-pull-" })
    yield* Effect.logInfo(`helm: pulling ${input.chart}@${input.version} from ${input.repo}`)
    yield* _pullIntoTemp(input, pullDir).pipe(
      Effect.ensuring(fs.remove(pullDir, { recursive: true, force: true }).pipe(Effect.ignore))
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

type _ReleaseError = HelmRenderError | HelmVersionTooLow | HelmMinVersionInvalid | HelmDigestMismatch

// HelmVersionTooLow and HelmDigestMismatch already name the chart and carry a
// precise message, so they pass through; everything else is wrapped with the
// phase it failed in.
const _inPhase =
  (opts: HelmReleaseOptions, phase: HelmRenderPhase) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, _ReleaseError, R> =>
    Effect.mapError(
      self,
      (cause): _ReleaseError =>
        cause instanceof HelmVersionTooLow || cause instanceof HelmMinVersionInvalid ||
          cause instanceof HelmDigestMismatch || cause instanceof HelmRenderError
          ? cause
          : new HelmRenderError({ chart: opts.chart, version: opts.version, phase, cause })
    )

// cacheDir is read from Config (KONFIG_HELM_CACHE) rather than accepted
// as a HelmReleaseOptions field: the CLI's build/validate/diff
// commands install a ConfigProvider around the whole render (env var
// > konfig.json's `helm.cacheDir` > this default, resolved once in
// cliConfig.ts#resolveCliPaths), so every Helm.release() call shares one
// resolved cache directory without threading it through every call site.
// `minVersion` stays a plain, opt-in field: it is a per-chart floor a chart
// author chooses, not a shared filesystem path.
const _resolveCacheDir = (opts: HelmReleaseOptions) =>
  Effect.gen(function*() {
    const path = yield* Path
    return yield* Config.String(KONFIG_HELM_CACHE_ENV).pipe(
      Config.withDefault(path.resolve(DEFAULT_HELM_CACHE_DIR)),
      _inPhase(opts, "pull")
    )
  })

const _writeValues = (opts: HelmReleaseOptions) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const tmpDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-helm-" }).pipe(_inPhase(opts, "template"))
    const valuesFile = path.join(tmpDir, "values.yaml")
    yield* fs.writeFileString(valuesFile, YAML.stringify(opts.values, { lineWidth: 0 })).pipe(
      _inPhase(opts, "template")
    )
    return valuesFile
  })

const _templateCommand = (
  input: {
    readonly opts: HelmReleaseOptions
    readonly releaseName: string
    readonly cachedTgz: string
    readonly valuesFile: string
  }
) =>
  ChildProcess.make("helm", [
    "template",
    input.releaseName,
    input.cachedTgz,
    "--values",
    input.valuesFile,
    ...(input.opts.namespace !== undefined ? ["--namespace", input.opts.namespace] : []),
    ...(input.opts.extraOpts ?? [])
  ])

const _runTemplate = (
  input: { readonly opts: HelmReleaseOptions; readonly cachedTgz: string; readonly valuesFile: string }
) =>
  Effect.gen(function*() {
    const { opts } = input
    const releaseName = opts.releaseName ?? opts.chart
    const template = _templateCommand({ ...input, releaseName })
    yield* Effect.logDebug(`helm: templating ${opts.chart}@${opts.version} as release ${releaseName}`)
    return yield* timeout.pipe(
      Effect.flatMap((t) => runProcessString(template, { allowEmptyStdout: false, timeout: t })),
      _inPhase(opts, "template")
    )
  })

const _preflight = (opts: HelmReleaseOptions) =>
  opts.minVersion === undefined
    ? Effect.void
    : assertMinVersion(opts.minVersion).pipe(_inPhase(opts, "version-check"))

const _releaseDocs = (opts: HelmReleaseOptions) =>
  Effect.gen(function*() {
    yield* _preflight(opts)
    const cacheDir = yield* _resolveCacheDir(opts)
    const cachedTgz = yield* ensureChartTarball({ ...opts, cacheDir }).pipe(_inPhase(opts, "pull"))
    const valuesFile = yield* _writeValues(opts)
    const output = yield* _runTemplate({ opts, cachedTgz, valuesFile })
    return yield* _parseHelmOutput({
      output,
      chart: opts.chart,
      version: opts.version,
      namespace: opts.namespace,
      clusterScopedKinds: opts.clusterScopedKinds
    }).pipe(_inPhase(opts, "parse"))
  })

export const release = (opts: HelmReleaseOptions): Manifest<ParsedDoc[]> =>
  make<ParsedDoc[]>(() => _releaseDocs(opts).pipe(Effect.scoped))
