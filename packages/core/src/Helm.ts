import { Config, Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import * as YAML from "yaml"
import { unsafeCoerce } from "./_cast"
import { ChildProcess, ChildProcessSpawner } from "./_unstable"
import { parseYamlAll } from "./diff"
import { DEFAULT_HELM_CACHE_DIR, KONFIG_HELM_CACHE_ENV } from "./konfigDefaults"
import { make, type Manifest, type RawYaml } from "./Manifest"
import { HelmDigestMismatch, HelmRenderError, HelmVersionTooLow } from "./RenderError"
import { runProcessExit, runProcessString } from "./subprocess"

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
interface _ParsedDocShape {
  readonly kind?: string
  readonly metadata?: { readonly namespace?: string }
}

const _asDocShape = (value: unknown): _ParsedDocShape | null =>
  value !== null && typeof value === "object"
    ? unsafeCoerce<_ParsedDocShape>(
      value,
      "parseYamlAll returned a parsed document object; the kind/metadata reads below are each typeof-guarded"
    )
    : null

// Uses parseYamlAll (not a naive /^---$/m split) so a `---` inside a block scalar can't
// spuriously split one manifest into two.
const _parseHelmOutput = (input: _ParseHelmOutputInput): Effect.Effect<RawYaml[]> =>
  Effect.sync(() => {
    const { output, chart, version, namespace } = input
    const origin = `helm:${chart}@${version}`
    const results: RawYaml[] = []
    for (const parsed of parseYamlAll(output)) {
      let value: unknown = parsed
      if (namespace !== undefined) {
        const shape = _asDocShape(parsed)
        if (
          shape !== null &&
          typeof shape.kind === "string" &&
          !CLUSTER_SCOPED_KINDS.has(shape.kind) &&
          (shape.metadata?.namespace === undefined || shape.metadata.namespace === "")
        ) {
          value = { ...shape, metadata: { ...shape.metadata, namespace } }
        }
      }
      let content = `---\n${YAML.stringify(value, { lineWidth: 0 })}`
      if (!content.endsWith("\n")) content += "\n"
      results.push({ _tag: "RawYaml", content, origin })
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

const _assertHelmMinVersion = (
  minVersion: string
): Effect.Effect<void, HelmVersionTooLow, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const cmd = ChildProcess.make("helm", ["version", "--short"])
    const stdout = yield* runProcessString(cmd, { allowEmptyStdout: false }).pipe(
      Effect.mapError(() => new HelmVersionTooLow({ required: minVersion, found: "not found" }))
    )
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

const _toHex = (buf: ArrayBuffer): string => {
  const view = new Uint8Array(buf)
  let hex = ""
  for (let i = 0; i < view.length; i++) {
    hex += (view[i] ?? 0).toString(16).padStart(2, "0")
  }
  return hex
}

// tsconfig lib is ES2022 (no DOM), so Crypto isn't declared; minimal local typing instead.
interface _SubtleCrypto {
  readonly digest: (algorithm: "SHA-256", data: ArrayBufferView) => Promise<ArrayBuffer>
}
interface _CryptoGlobal {
  readonly subtle: _SubtleCrypto
}

// crypto.subtle is a runtime global on Node >=20 and Bun; avoids a node:crypto import.
const _hashFile = (filePath: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const bytes = yield* fs.readFile(filePath)
    const subtle = unsafeCoerce<{ readonly crypto: _CryptoGlobal }>(
      globalThis,
      "globalThis.crypto is provided by the runtime (Node ≥ 20, Bun) — typed via local _CryptoGlobal interface"
    ).crypto.subtle
    const digest = yield* Effect.promise(() => subtle.digest("SHA-256", bytes))
    return `sha256:${_toHex(digest)}`
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
    const actual = yield* _hashFile(input.cachedTgz)
    if (expected !== actual) {
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
const _ensureCachedTarball = (input: _EnsureCachedTarballInput) =>
  Effect.gen(function*() {
    const { opts, cacheDir, cachedTgz } = input
    const fs = yield* FileSystem
    const path = yield* Path

    const cacheExists = yield* fs.exists(cachedTgz)
    if (cacheExists) {
      yield* verifyChartDigest({ chart: opts.chart, version: opts.version, digest: opts.digest, cachedTgz })
      return
    }

    // Pull into a per-invocation temp directory nested inside cacheDir (same
    // filesystem, so the rename below is atomic), then rename the known
    // output into place. This replaces diffing directory listings
    // before/after `helm pull`, which misattributed tarballs when concurrent
    // releases shared KONFIG_HELM_CACHE.
    const pullDir = yield* fs.makeTempDirectory({ directory: cacheDir, prefix: ".konfig-helm-pull-" })

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
      yield* runProcessExit(pull)

      const pulledFiles = yield* fs.readDirectory(pullDir)
      const candidates = pulledFiles.filter((f) => f.endsWith(".tgz") && f.startsWith(opts.chart))
      const pulled = candidates[0]
      if (candidates.length !== 1 || pulled === undefined) {
        return yield* new HelmRenderError({
          chart: opts.chart,
          version: opts.version,
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

export const release = (opts: HelmReleaseOptions): Manifest<RawYaml[]> => {
  const extraOpts = opts.extraOpts ?? []

  return make<RawYaml[]>(() =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path

      if (opts.minVersion !== undefined) {
        yield* _assertHelmMinVersion(opts.minVersion)
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
      const cacheDir = yield* Config.string(KONFIG_HELM_CACHE_ENV).pipe(
        Config.withDefault(path.resolve(DEFAULT_HELM_CACHE_DIR))
      )
      yield* fs.makeDirectory(cacheDir, { recursive: true })

      const cachedTgz = path.join(
        cacheDir,
        cacheFileName({ chart: opts.chart, version: opts.version, digest: opts.digest })
      )
      yield* _ensureCachedTarball({ opts, cacheDir, cachedTgz })

      const tmpDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-helm-" })
      const valuesFile = path.join(tmpDir, "values.yaml")
      yield* fs.writeFileString(valuesFile, YAML.stringify(opts.values, { lineWidth: 0 }))

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
      const stdout = yield* runProcessString(template, { allowEmptyStdout: false })
      return yield* _parseHelmOutput({
        output: stdout,
        chart: opts.chart,
        version: opts.version,
        namespace: opts.namespace
      })
    }).pipe(
      Effect.scoped,
      Effect.mapError((cause) =>
        cause instanceof HelmVersionTooLow
          ? cause
          : new HelmRenderError({ chart: opts.chart, version: opts.version, cause })
      )
    )
  )
}
