import { Config, Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import * as YAML from "yaml"
import { unsafeCoerce } from "./_cast"
import { ChildProcess, ChildProcessSpawner } from "./_unstable"
import { parseYamlAll } from "./diff"
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
  /**
   * Minimum acceptable `helm` CLI version (semver, e.g. `"3.16.0"`).
   * When set, `release` runs a `helm version --short` preflight before
   * pulling/templating and fails with `HelmVersionTooLow` if the
   * installed helm is older (or absent). Omit to skip the check.
   */
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

/**
 * Turn `helm template` stdout into individual `RawYaml` docs.
 *
 * Document boundaries come from the shared `parseYamlAll`
 * (`YAML.parseAllDocuments`) helper rather than a naive `/^---$/m` split,
 * so a `---` appearing inside a block scalar can't spuriously split one
 * manifest into two. `parseYamlAll` also drops empty / comment-only
 * segments for us.
 *
 * When a `namespace` is supplied, each namespaced-kind document that
 * lacks an explicit namespace is patched to carry it (the re-parse
 * branch behavior). Cluster-scoped kinds and documents that already pin
 * a namespace are left untouched.
 */
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

/** Extract a `major.minor.patch` triple from a version string, or `null`. */
const _parseVersionTriple = (text: string): readonly [number, number, number] | null => {
  const m = _HELM_VERSION_RE.exec(text.trim())
  if (m === null) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** True when `found` is strictly older than `min` (release triple compare). */
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

/**
 * One-shot `helm version --short` preflight. Fails `HelmVersionTooLow`
 * when helm is absent/unparseable or older than `minVersion`. Pre-release
 * / build metadata on the installed version is ignored — only the release
 * triple gates the check.
 */
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
      return yield* Effect.fail(
        new HelmVersionTooLow({ required: minVersion, found: stdout.trim() })
      )
    }
  })

const _normalizeDigest = (digest: string): string => digest.startsWith("sha256:") ? digest : `sha256:${digest}`

const _toHex = (buf: ArrayBuffer): string => {
  const view = new Uint8Array(buf)
  let hex = ""
  for (let i = 0; i < view.length; i++) {
    hex += (view[i] ?? 0).toString(16).padStart(2, "0")
  }
  return hex
}

// Minimal local typing for `crypto.subtle.digest`. The base tsconfig is
// `lib: ["ES2022"]` (no DOM), so `BufferSource` / `Crypto` are not declared;
// we define just enough to drive the runtime call without dragging the
// whole DOM lib in.
interface _SubtleCrypto {
  readonly digest: (algorithm: "SHA-256", data: ArrayBufferView) => Promise<ArrayBuffer>
}
interface _CryptoGlobal {
  readonly subtle: _SubtleCrypto
}

/**
 * SHA-256 the file at `filePath` via Web Crypto API (`crypto.subtle.digest`).
 * `crypto.subtle` is a runtime global on Node ≥ 20 and on Bun; no
 * `node:crypto` import is needed, which keeps the file portable across
 * the runtimes Effect targets.
 */
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

interface _VerifyDigestInput {
  readonly opts: HelmReleaseOptions
  readonly cachedTgz: string
}

const _verifyDigest = (input: _VerifyDigestInput) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const expected = _normalizeDigest(input.opts.digest)
    const actual = yield* _hashFile(input.cachedTgz)
    if (expected !== actual) {
      yield* fs.remove(input.cachedTgz).pipe(Effect.ignore)
      return yield* Effect.fail(
        new HelmDigestMismatch({
          chart: input.opts.chart,
          version: input.opts.version,
          expected,
          actual
        })
      )
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
      yield* _verifyDigest({ opts, cachedTgz })
      return
    }

    const beforeFiles = new Set(
      yield* fs.readDirectory(cacheDir).pipe(Effect.orElseSucceed((): string[] => []))
    )

    const pull = ChildProcess.make("helm", [
      "pull",
      "--repo",
      opts.repo,
      opts.chart,
      "--version",
      opts.version,
      "--destination",
      cacheDir
    ])
    yield* runProcessExit(pull)

    const afterFiles = yield* fs.readDirectory(cacheDir)
    const candidates = afterFiles.filter(
      (f) =>
        f.endsWith(".tgz") &&
        f.startsWith(opts.chart) &&
        !beforeFiles.has(f) &&
        path.join(cacheDir, f) !== cachedTgz
    )
    if (candidates.length > 0) {
      yield* fs.rename(path.join(cacheDir, candidates[0] ?? ""), cachedTgz)
    }
    yield* _verifyDigest({ opts, cachedTgz })
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

      const cacheDir = yield* Config.string("KONFIG_HELM_CACHE").pipe(
        Config.withDefault(path.resolve(".konfig", "helm-cache"))
      )
      yield* fs.makeDirectory(cacheDir, { recursive: true })

      const digestSuffix = opts.digest.replace(/^sha256:/, "").slice(0, 12)
      const cachedTgz = path.join(cacheDir, `${opts.chart}-${opts.version}-${digestSuffix}.tgz`)
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
        // The version preflight already produces a typed HelmVersionTooLow;
        // surface it as-is rather than burying it inside HelmRenderError.
        cause instanceof HelmVersionTooLow
          ? cause
          : new HelmRenderError({ chart: opts.chart, version: opts.version, cause })
      )
    )
  )
}
