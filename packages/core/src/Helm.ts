import { Effect, Predicate } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { ChildProcess } from "effect/process"
import * as YAML from "yaml"
import { ensureChartTarball } from "./helm/cache"
import { _parseHelmOutput } from "./helm/output"
import { timeout } from "./helm/timeout"
import { assertMinVersion } from "./helm/version"
import { helmCacheDirConfig } from "./konfigDefaults"
import { make, type Manifest, type ParsedDoc } from "./Manifest"
import type { RenderContext } from "./RenderContext"
import {
  HelmDigestMismatch,
  HelmMinVersionInvalid,
  HelmRenderError,
  type HelmRenderPhase,
  HelmVersionTooLow
} from "./RenderError"
import { runProcessString } from "./subprocess"
import type { YamlRecord } from "./yaml/record"

interface HelmReleaseOptions {
  readonly repo: string
  readonly chart: string
  readonly releaseName?: string
  readonly version: string
  readonly digest: string
  readonly namespace?: string
  readonly values: YamlRecord
  readonly extraOpts?: readonly string[]
  // When set, runs a `helm version --short` preflight and fails HelmVersionTooLow if older.
  readonly minVersion?: string
  // Custom-resource kinds to treat as cluster-scoped when their CRD is not part of the chart output.
  readonly clusterScopedKinds?: ReadonlyArray<string>
}

type _ReleaseError = HelmRenderError | HelmVersionTooLow | HelmMinVersionInvalid | HelmDigestMismatch

const _releaseErrorTags: ReadonlySet<string> = new Set([
  "HelmRenderError",
  "HelmVersionTooLow",
  "HelmMinVersionInvalid",
  "HelmDigestMismatch"
])

const _isReleaseError = (cause: unknown): cause is _ReleaseError =>
  Predicate.hasProperty(cause, "_tag") && Predicate.isString(cause._tag) && _releaseErrorTags.has(cause._tag)

// HelmVersionTooLow and HelmDigestMismatch already name the chart and carry a
// precise message, so they pass through; everything else is wrapped with the
// phase it failed in.
const _inPhase =
  (input: { readonly opts: HelmReleaseOptions; readonly phase: HelmRenderPhase }) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, _ReleaseError, R> =>
    Effect.mapError(
      self,
      (cause): _ReleaseError =>
        _isReleaseError(cause)
          ? cause
          : new HelmRenderError({ chart: input.opts.chart, version: input.opts.version, phase: input.phase, cause })
    )

// cacheDir is read from Config (KONFIG_HELM_CACHE) rather than accepted
// as a HelmReleaseOptions field: the CLI's build/validate/diff
// commands install a ConfigProvider around the whole render (env var
// > konfig.json's `helm.cacheDir` > this default, resolved once in
// cliConfig.ts#resolveCliPaths), so every Helm.release() call shares one
// resolved cache directory without threading it through every call site.
// `minVersion` stays a plain, opt-in field: it is a per-chart floor a chart
// author chooses, not a shared filesystem path.
const _resolveCacheDir = (opts: HelmReleaseOptions) => helmCacheDirConfig.pipe(_inPhase({ opts, phase: "pull" }))

export const _valuesYaml = (values: YamlRecord): string =>
  YAML.stringify(values, {
    lineWidth: 0,
    version: "1.1",
    defaultStringType: "QUOTE_DOUBLE",
    defaultKeyType: "QUOTE_DOUBLE"
  })

const _writeValues = (opts: HelmReleaseOptions) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path

    const tmpDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-helm-" }).pipe(
      _inPhase({ opts, phase: "template" })
    )

    const valuesFile = path.join(tmpDir, "values.yaml")
    yield* fs.writeFileString(valuesFile, _valuesYaml(opts.values)).pipe(
      _inPhase({ opts, phase: "template" })
    )

    return valuesFile
  })

const _kubeVersionArgs = (input: { readonly extraOpts: readonly string[]; readonly ctx: RenderContext }) =>
  input.ctx.k8sVersion === undefined ||
    input.extraOpts.some((o) => o === "--kube-version" || o.startsWith("--kube-version="))
    ? []
    : ["--kube-version", input.ctx.k8sVersion]

const _templateCommand = (
  input: {
    readonly ctx: RenderContext
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
    ...(input.opts.extraOpts ?? []),
    ..._kubeVersionArgs({ extraOpts: input.opts.extraOpts ?? [], ctx: input.ctx })
  ])

const _runTemplate = (
  input: {
    readonly opts: HelmReleaseOptions
    readonly ctx: RenderContext
    readonly cachedTgz: string
    readonly valuesFile: string
  }
) =>
  Effect.gen(function*() {
    const { opts } = input
    const releaseName = opts.releaseName ?? opts.chart
    const template = _templateCommand({ ...input, releaseName })
    yield* Effect.logDebug(`helm: templating ${opts.chart}@${opts.version} as release ${releaseName}`)

    return yield* timeout.pipe(
      Effect.flatMap((t) => runProcessString({ command: template, options: { allowEmptyStdout: false, timeout: t } })),
      _inPhase({ opts, phase: "template" })
    )
  })

const _preflight = (opts: HelmReleaseOptions) =>
  opts.minVersion === undefined
    ? Effect.void
    : assertMinVersion(opts.minVersion).pipe(_inPhase({ opts, phase: "version-check" }))

const _releaseDocs = ({ opts, ctx }: { readonly opts: HelmReleaseOptions; readonly ctx: RenderContext }) =>
  Effect.gen(function*() {
    yield* _preflight(opts)
    const cacheDir = yield* _resolveCacheDir(opts)
    const cachedTgz = yield* ensureChartTarball({ ...opts, cacheDir }).pipe(_inPhase({ opts, phase: "pull" }))
    const valuesFile = yield* _writeValues(opts)
    const output = yield* _runTemplate({ opts, ctx, cachedTgz, valuesFile })

    return yield* _parseHelmOutput({
      output,
      chart: opts.chart,
      version: opts.version,
      namespace: opts.namespace,
      clusterScopedKinds: opts.clusterScopedKinds
    }).pipe(_inPhase({ opts, phase: "parse" }))
  })

export const release = (opts: HelmReleaseOptions): Manifest<ParsedDoc[]> =>
  make<ParsedDoc[]>((ctx) => _releaseDocs({ opts, ctx }).pipe(Effect.scoped))
