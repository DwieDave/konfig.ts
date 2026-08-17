import { applicationCRFilename, type AppOfAppsResult, serializeApplicationCR } from "@konfig.ts/argocd"
import {
  type AnyRenderError,
  type Bundle,
  KONFIG_HELM_CACHE_ENV,
  type Manifest as M,
  parseYamlAll,
  type RenderContext,
  renderManifest,
  type ResolvedKonfigConfig,
  unsafeCoerce,
  Yaml
} from "@konfig.ts/core"
import { ConfigProvider, Data, Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { resolveCliPaths } from "./cliConfig"

export interface EnvOutDirInput {
  readonly cfg: ResolvedKonfigConfig
  readonly envName: string
  readonly ctx: RenderContext
  readonly pathJoin: (...parts: string[]) => string
}
export const envOutDir = (input: EnvOutDirInput): string =>
  input.pathJoin(
    input.cfg.configDir,
    input.cfg.config.root,
    input.cfg.config.outDir.manifests,
    input.envName,
    ...(input.ctx.cluster !== undefined ? [input.ctx.cluster] : [])
  )

class EnvEntryNotFound extends Data.TaggedError("EnvEntryNotFound")<{
  readonly env: string
  readonly entry: string
}> {}

class EnvLoadError extends Data.TaggedError("EnvLoadError")<{
  readonly entry: string
  readonly cause: unknown
}> {}

interface _ResolveEnvEntryInput {
  readonly cfg: ResolvedKonfigConfig
  readonly envName: string
}
const _resolveEnvEntry = (input: _ResolveEnvEntryInput) =>
  Effect.gen(function*() {
    const { cfg, envName } = input
    const path = yield* Path
    const fs = yield* FileSystem

    const envSpec = cfg.config.envs[envName]
    const entry = envSpec === undefined
      ? path.join(cfg.configDir, cfg.config.root, "env", `${envName}.ts`)
      : path.join(cfg.configDir, cfg.config.root, envSpec.entry)

    const exists = yield* fs.exists(entry).pipe(Effect.orElseSucceed(() => false))
    if (!exists) {
      return yield* new EnvEntryNotFound({ env: envName, entry })
    }
    return entry
  })

type EnvResult = AppOfAppsResult | Bundle.BundleSetResult

const _isAppOfApps = (r: EnvResult): r is AppOfAppsResult => "apps" in r

const _loadEnv = (entry: string) =>
  Effect.gen(function*() {
    const mod = yield* Effect.tryPromise({
      try: () => import(entry),
      catch: (cause) => new EnvLoadError({ entry, cause })
    })
    const program = unsafeCoerce<{ default?: unknown }>(mod, "imported module is a plain JS object").default
    if (program === undefined) {
      return yield* new EnvLoadError({ entry, cause: "default export is missing" })
    }
    const isEffectProgram: boolean = Effect.isEffect(program)
    if (!isEffectProgram) {
      return yield* new EnvLoadError({
        entry,
        cause: "default export is not an Effect — env entries must default-export an AppOfApps or Bundle program Effect"
      })
    }
    const result = yield* unsafeCoerce<Effect.Effect<EnvResult, AnyRenderError>>(
      program,
      "isEffectProgram confirmed above; narrowing the proven Effect's A/E per the env entry contract"
    )
    return result
  })

interface OutputFile {
  readonly path: string
  readonly content: string
}

interface _SplitRawYamlInput {
  readonly content: string
  readonly dir: string
  readonly pathSep: (...parts: string[]) => string
}
const _splitRawYaml = (input: _SplitRawYamlInput): OutputFile[] => {
  const { content, dir, pathSep } = input
  const files: OutputFile[] = []
  // parseYamlAll splits on real YAML doc boundaries, not a naive /^---$/m
  // regex, so a literal `---` inside a block scalar isn't mis-split.
  for (const doc of parseYamlAll(content)) {
    if (doc === null || typeof doc !== "object") continue
    const parsed = unsafeCoerce<{ kind?: string; metadata?: { name?: string } }>(
      doc,
      "parsed YAML doc (narrowed to object above) — runtime typeof checks below filter to the kind/metadata.name shape"
    )
    const kind = parsed.kind
    const name = parsed.metadata?.name
    if (typeof kind !== "string" || typeof name !== "string") continue
    files.push({
      path: pathSep(dir, Yaml.filenameFor({ kind, metadata: { name } })),
      content: Yaml.serialize({ value: parsed })
    })
  }
  return files
}

interface _CollectOutputsInput {
  readonly value: unknown
  readonly appDir: string
  readonly pathJoin: (...parts: string[]) => string
}
const _collectOutputs = (input: _CollectOutputsInput): OutputFile[] => {
  const { value, appDir, pathJoin } = input
  if (value === null || value === undefined) return []

  if (
    typeof value === "object" &&
    value !== null &&
    unsafeCoerce<{ _tag?: unknown }>(value, "narrowed to object above; reading optional _tag")._tag === "RawYaml"
  ) {
    const raw = unsafeCoerce<{ content: string }>(value, "RawYaml _tag implies the content field")
    return _splitRawYaml({ content: raw.content, dir: appDir, pathSep: pathJoin })
  }

  if (Array.isArray(value)) {
    return value.flatMap((v) => _collectOutputs({ value: v, appDir, pathJoin }))
  }

  if (typeof value === "object") {
    const obj = unsafeCoerce<{ kind?: unknown; metadata?: { name?: unknown } }>(
      value,
      "narrowed to object above; probing kind/metadata.name"
    )
    if (typeof obj.kind === "string" && typeof obj.metadata?.name === "string") {
      return [
        {
          path: pathJoin(
            appDir,
            Yaml.filenameFor({ kind: obj.kind, metadata: { name: obj.metadata.name } })
          ),
          content: Yaml.serialize({ value: obj })
        }
      ]
    }
  }

  return []
}

export interface RenderedEnv {
  readonly appsDirAbs: string
  readonly outDirAbs: string
  readonly files: ReadonlyArray<OutputFile>
}

type AnyManifest = M.Manifest<unknown>

interface EnvChildArgo {
  readonly app: AppOfAppsResult["apps"][number]
  readonly target: AppOfAppsResult["target"]
  readonly defaults: AppOfAppsResult["defaults"]
}

interface EnvChild {
  readonly name: string
  readonly manifests: ReadonlyArray<unknown>
  readonly argo: EnvChildArgo | undefined
}

const _childrenOf = (result: EnvResult): EnvChild[] =>
  _isAppOfApps(result)
    ? result.apps.map((app) => ({
      name: app.name,
      manifests: app.manifests,
      argo: { app, target: result.target, defaults: result.defaults }
    }))
    : result.bundles.map((b) => ({
      name: b.name,
      manifests: b.manifests,
      argo: undefined
    }))

interface RenderChildInput {
  readonly child: EnvChild
  readonly outDirAbs: string
  readonly appsDirAbs: string
  readonly ctx: RenderContext
  readonly path: Path
}

const _renderChild = (input: RenderChildInput) =>
  Effect.gen(function*() {
    const { appsDirAbs, child, ctx, outDirAbs, path } = input
    const appDir = path.join(outDirAbs, child.name)
    const rendered = yield* Effect.all(
      child.manifests.map((m) =>
        renderManifest({
          manifest: unsafeCoerce<AnyManifest>(
            m,
            "child.manifests holds Manifest<unknown> by Bundle/Application contract"
          ),
          ctx
        })
      ),
      { concurrency: "unbounded" }
    )
    const out: OutputFile[] = []
    for (const value of rendered) {
      out.push(..._collectOutputs({ value, appDir, pathJoin: path.join }))
    }
    if (child.argo !== undefined) {
      out.push({
        path: path.join(appsDirAbs, applicationCRFilename(child.argo.app)),
        content: serializeApplicationCR({
          app: child.argo.app,
          target: child.argo.target,
          defaults: child.argo.defaults
        })
      })
    }
    return out
  })

export interface RenderEnvInput {
  readonly cfg: ResolvedKonfigConfig
  readonly envName: string
  readonly ctx: RenderContext
}
const _renderEnvBody = (input: RenderEnvInput) =>
  Effect.gen(function*() {
    const { cfg, envName, ctx } = input
    const path = yield* Path
    const entry = yield* _resolveEnvEntry({ cfg, envName })
    const result = yield* _loadEnv(entry)

    const outDirAbs = envOutDir({ cfg, envName, ctx, pathJoin: path.join })
    const appsDirAbs = path.join(outDirAbs, result.name)

    const children = _childrenOf(result)

    // Bounded at 4: keeps the helm/sops subprocess count manageable.
    const perAppFiles = yield* Effect.all(
      children.map((child) => _renderChild({ appsDirAbs, child, ctx, outDirAbs, path })),
      { concurrency: 4 }
    )
    const files: OutputFile[] = perAppFiles.flat()

    return unsafeCoerce<RenderedEnv>(
      { appsDirAbs, outDirAbs, files },
      "shape matches RenderedEnv exactly; mutable file[] widened to readonly"
    )
  }).pipe(Effect.scoped)

export const renderEnv = (input: RenderEnvInput) =>
  Effect.gen(function*() {
    // Chart definitions call `Helm.release` without a `cacheDir` option — it
    // reads `Config(KONFIG_HELM_CACHE)` itself (see core's Helm.ts) at
    // manifest-render time, inside `_renderChild`/`renderManifest` below.
    // Resolving konfig.json's `helm.cacheDir` once here (same env var >
    // config > default precedence as `resolveCliPaths`, used by `crd
    // extract`/`helm fetch`) and installing it as a ConfigProvider around
    // the whole render is how that value reaches every `Helm.release()`
    // call a chart makes, without threading `cacheDir` through
    // `_loadEnv`/`_renderChild`. `ConfigProvider.orElse` keeps a real env
    // var override on top: it's tried first, only falling back to the
    // resolved value for the one KONFIG_HELM_CACHE key.
    const { cacheDir } = yield* resolveCliPaths(input.cfg)
    const helmConfigProvider = ConfigProvider.orElse(
      ConfigProvider.fromEnv(),
      ConfigProvider.fromUnknown({ [KONFIG_HELM_CACHE_ENV]: cacheDir })
    )
    return yield* _renderEnvBody(input).pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, helmConfigProvider)
    )
  })

export class WriteEnvError extends Data.TaggedError("WriteEnvError")<{
  readonly path: string
  readonly cause: unknown
}> {}

export interface WriteFilesToDirInput {
  readonly rendered: RenderedEnv
  readonly targetDir: string
}

// Re-homes `rendered.files` (keyed off `rendered.outDirAbs`) under an
// arbitrary `targetDir`, preserving the per-app layout/naming that
// `_renderChild`/`_collectOutputs` computed. Shared by `writeFiles` (staging
// dir for `konfig build`) and `konfig validate --strict` (a scratch temp dir
// so kubeconform sees the *current* render, not the last `build`'s output).
export const writeFilesToDir = (
  input: WriteFilesToDirInput
): Effect.Effect<ReadonlyArray<string>, WriteEnvError, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const { rendered, targetDir } = input

    const written: string[] = []
    for (const file of rendered.files) {
      const rel = path.relative(rendered.outDirAbs, file.path)
      const targetPath = path.join(targetDir, rel)
      yield* fs
        .makeDirectory(path.dirname(targetPath), { recursive: true })
        .pipe(Effect.mapError((cause) => new WriteEnvError({ path: targetPath, cause })))
      yield* fs
        .writeFileString(targetPath, file.content, { mode: 0o600 })
        .pipe(Effect.mapError((cause) => new WriteEnvError({ path: targetPath, cause })))
      written.push(targetPath)
    }
    return written
  })

// Atomic write: stage all files under `<outDir>.tmp`, then remove the live
// `<outDir>` and rename `.tmp` into place — a kill mid-write never leaves a
// half-rewritten live tree.
export const writeFiles = (
  rendered: RenderedEnv
): Effect.Effect<ReadonlyArray<string>, WriteEnvError, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path

    const stagingDir = `${rendered.outDirAbs}.tmp`

    const stagingExists = yield* fs.exists(stagingDir).pipe(Effect.orElseSucceed(() => false))
    if (stagingExists) {
      yield* fs
        .remove(stagingDir, { recursive: true })
        .pipe(Effect.mapError((cause) => new WriteEnvError({ path: stagingDir, cause })))
    }

    yield* writeFilesToDir({ rendered, targetDir: stagingDir })
    const written = rendered.files.map((file) => file.path)

    const liveExists = yield* fs.exists(rendered.outDirAbs).pipe(Effect.orElseSucceed(() => false))
    if (liveExists) {
      yield* fs
        .remove(rendered.outDirAbs, { recursive: true })
        .pipe(Effect.mapError((cause) => new WriteEnvError({ path: rendered.outDirAbs, cause })))
    }
    yield* fs
      .makeDirectory(path.dirname(rendered.outDirAbs), { recursive: true })
      .pipe(
        Effect.mapError(
          (cause) => new WriteEnvError({ path: rendered.outDirAbs, cause })
        )
      )
    yield* fs
      .rename(stagingDir, rendered.outDirAbs)
      .pipe(Effect.mapError((cause) => new WriteEnvError({ path: rendered.outDirAbs, cause })))
    return written
  })
